/**
 * @file 聊天数据层：会话列表、按会话缓存的消息、选中/折叠状态，以及 AI 流式回复。
 * 消息分页加载：打开会话只取最近一页，滚到顶部附近再取更早的一页插到前面；
 * 流式回复期间用 streaming.bubbles 逐行暂存 AI 气泡，流结束后重新拉取最新一页，与已加载的更早历史合并；
 * 停止生成先走后端 /chat/stop（它返回时服务端已落库并以 [DONE] 结束流），本地 AbortController 只兜底结束 fetch。
 * 所有动作失败时自行 toast，不向调用方 reject（网络与鉴权是唯一的错误边界）。
 */
import { create } from 'zustand';
import { toastError } from '@/components/toastStore';
import { CHARACTERS } from '@/constants/characters';
import { ApiError, tokenStorage } from '@/lib/http';
import { streamSse, takeCompletedLines } from '@/lib/sse';
import { onUserSwitch } from '@/features/auth/userSwitch';
import {
  clearContext as apiClearContext,
  clearMessages as apiClearMessages,
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getConversations,
  getMessages,
  stopChat,
  type Conversation,
  type Message,
  type MessagePage,
} from '@/features/chat/api';

/** 进行中的 AI 回复 */
export interface StreamingState {
  /** 目标会话；用户切到别的会话时，回复仍写回这里 */
  conversationId: number;
  /** 已收完整的行，每行一个临时气泡 */
  bubbles: string[];
  /** 还会有新内容（显示加载气泡）；用户请求停止后、以及流结束到消息重拉完成之间为 false，bubbles 仍保留 */
  pending: boolean;
  /** 本地 fetch 的取消句柄；stop 返回后用它兜底结束读取 */
  controller: AbortController;
}

/** 聊天数据；reset 回到 INITIAL */
interface ChatData {
  conversations: Conversation[];
  /** 会话 id → 已加载的消息（最近一页加上已加载的更早历史）；未加载过的会话没有键 */
  messagesByConversation: Record<number, Message[]>;
  /** 会话 id → 已加载的消息之前是否还有更早的消息 */
  hasMoreByConversation: Record<number, boolean>;
  /** 正在加载更早历史的会话；同一时刻只进行一次 */
  loadingEarlierId: number | null;
  activeConversationId: number | null;
  /** 选中的主卡（常显白色遮罩）；点主卡或选子卡都会设置 */
  activeCharacterName: string | null;
  /** 角色名 → 是否折叠，默认全部折叠 */
  collapsedCharacters: Record<string, boolean>;
  streaming: StreamingState | null;
}

/** 聊天 store */
export interface ChatState extends ChatData {
  /** 拉取全部会话 */
  loadConversations: () => Promise<void>;
  /** 选中会话并拉取最近一页消息，同时选中所属主卡 */
  selectConversation: (id: number) => Promise<void>;
  /** 加载某会话更早的一页消息并插到前面；没有更早的消息或已有加载在进行时不做任何事 */
  loadEarlierMessages: (id: number) => Promise<void>;
  /** 点主卡：切换折叠并设为选中主卡 */
  toggleCharacter: (name: string) => void;
  /** 为角色新建空会话：展开主卡并选中新会话 */
  createConversation: (characterName: string) => Promise<void>;
  /** 删除会话；若是当前会话，改选同角色的相邻会话 */
  deleteConversation: (id: number) => Promise<void>;
  /** 清空可见消息 */
  clearMessages: (id: number) => Promise<void>;
  /** 清空 AI 上下文 */
  clearContext: (id: number) => Promise<void>;
  /** 向当前会话发送消息并流式接收回复 */
  sendMessage: (text: string) => Promise<void>;
  /** 停止当前回复：先让后端落库并结束流，再结束本地 fetch；已显示的行保留到消息重拉 */
  stopGeneration: () => Promise<void>;
  /** 丢弃本地消息缓存（数据管理"清空全部消息"后） */
  forgetMessages: () => void;
  /** 中止进行中的回复流并回到初始状态：退出登录、切换账号、登录过期、删除全部对话后调用 */
  reset: () => void;
}

/** 初始状态：没有会话、没有选中、全部折叠、没有回复在进行 */
const INITIAL: ChatData = {
  conversations: [],
  messagesByConversation: {},
  hasMoreByConversation: {},
  loadingEarlierId: null,
  activeConversationId: null,
  activeCharacterName: null,
  collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
  streaming: null,
};

/** 用某会话的消息列表回写它的 last_message（子卡预览） */
function withLastMessage(
  conversations: Conversation[],
  id: number,
  messages: Message[],
): Conversation[] {
  const last = messages.at(-1);
  const lastMessage = last === undefined ? null : { side: last.side, text: last.text };
  return conversations.map((c) => (c.id === id ? { ...c, last_message: lastMessage } : c));
}

/**
 * 把最新一页与已加载的消息合并：两段有重叠时保留最新一页之前的已加载历史，乐观显示的临时消息（负数 id）丢弃；
 * 最新一页整体比已加载的消息更新（回复超过一页）时中间可能缺消息，只保留最新一页
 */
function mergeLatest(
  loaded: Message[] | undefined,
  page: MessagePage,
  hadMore: boolean,
): { messages: Message[]; hasMore: boolean } {
  const persisted = (loaded ?? []).filter((m) => m.id > 0);
  const first = page.items[0];
  const last = persisted.at(-1);
  if (first === undefined || last === undefined || first.id > last.id) {
    return { messages: page.items, hasMore: page.has_more };
  }
  const earlier = persisted.filter((m) => m.id < first.id);
  return {
    messages: [...earlier, ...page.items],
    hasMore: earlier.length > 0 ? hadMore : page.has_more,
  };
}

/** 聊天数据层 */
export const useChatStore = create<ChatState>()((set, get) => {
  /** 拉取某会话最近一页消息（替换已加载的消息）并同步它的预览 */
  async function reloadMessages(id: number): Promise<void> {
    const page = await getMessages(id);
    set((s) => ({
      messagesByConversation: { ...s.messagesByConversation, [id]: page.items },
      hasMoreByConversation: { ...s.hasMoreByConversation, [id]: page.has_more },
      conversations: withLastMessage(s.conversations, id, page.items),
    }));
  }

  return {
    ...INITIAL,

    loadConversations: async () => {
      try {
        set({ conversations: await getConversations() });
      } catch (err) {
        toastError(err);
      }
    },

    selectConversation: async (id) => {
      const conversation = get().conversations.find((c) => c.id === id);
      if (conversation === undefined) return;
      set({ activeConversationId: id, activeCharacterName: conversation.character_name });
      try {
        await reloadMessages(id);
      } catch (err) {
        toastError(err);
      }
    },

    loadEarlierMessages: async (id) => {
      const { loadingEarlierId, hasMoreByConversation, messagesByConversation } = get();
      const oldest = messagesByConversation[id]?.find((m) => m.id > 0);
      if (loadingEarlierId !== null || hasMoreByConversation[id] !== true || oldest === undefined) {
        return;
      }
      set({ loadingEarlierId: id });
      try {
        const page = await getMessages(id, oldest.id);
        set((s) => {
          const current = s.messagesByConversation[id];
          // 加载期间会话被重新打开或清空：最早一条已不是请求时那条，这一页作废
          if (current === undefined || current.find((m) => m.id > 0)?.id !== oldest.id) {
            return { loadingEarlierId: null };
          }
          return {
            messagesByConversation: {
              ...s.messagesByConversation,
              [id]: [...page.items, ...current],
            },
            hasMoreByConversation: { ...s.hasMoreByConversation, [id]: page.has_more },
            loadingEarlierId: null,
          };
        });
      } catch (err) {
        toastError(err);
        set({ loadingEarlierId: null });
      }
    },

    toggleCharacter: (name) =>
      set((s) => ({
        activeCharacterName: name,
        collapsedCharacters: { ...s.collapsedCharacters, [name]: !s.collapsedCharacters[name] },
      })),

    createConversation: async (characterName) => {
      try {
        const created = await apiCreateConversation(characterName);
        set((s) => {
          // 插在该角色最后一个会话之后，保持"角色内置顺序 + 创建时间"的列表顺序
          const index = s.conversations.findLastIndex((c) => c.character_name === characterName);
          const conversations = [...s.conversations];
          conversations.splice(index + 1, 0, created);
          return {
            conversations,
            messagesByConversation: { ...s.messagesByConversation, [created.id]: [] },
            hasMoreByConversation: { ...s.hasMoreByConversation, [created.id]: false },
            collapsedCharacters: { ...s.collapsedCharacters, [characterName]: false },
            activeConversationId: created.id,
            activeCharacterName: characterName,
          };
        });
      } catch (err) {
        toastError(err);
      }
    },

    deleteConversation: async (id) => {
      try {
        await apiDeleteConversation(id);
      } catch (err) {
        toastError(err);
        // 409（该角色只剩一个会话）说明本地列表已落后于服务端，重拉对齐
        if (err instanceof ApiError && err.status === 409) await get().loadConversations();
        return;
      }
      set((s) => {
        const removed = s.conversations.find((c) => c.id === id);
        const conversations = s.conversations.filter((c) => c.id !== id);
        const messagesByConversation = { ...s.messagesByConversation };
        delete messagesByConversation[id];
        const hasMoreByConversation = { ...s.hasMoreByConversation };
        delete hasMoreByConversation[id];
        if (removed === undefined || s.activeConversationId !== id) {
          return { conversations, messagesByConversation, hasMoreByConversation };
        }
        // 删的是当前会话：改选同角色中原位置的下一个，没有则上一个
        const siblings = conversations.filter((c) => c.character_name === removed.character_name);
        const oldIndex = s.conversations
          .filter((c) => c.character_name === removed.character_name)
          .findIndex((c) => c.id === id);
        const next = siblings[Math.min(oldIndex, siblings.length - 1)];
        return {
          conversations,
          messagesByConversation,
          hasMoreByConversation,
          activeConversationId: next.id,
        };
      });
      const nextId = get().activeConversationId;
      if (nextId !== null && get().messagesByConversation[nextId] === undefined) {
        await get().selectConversation(nextId);
      }
    },

    clearMessages: async (id) => {
      try {
        await apiClearMessages(id);
        set((s) => ({
          messagesByConversation: { ...s.messagesByConversation, [id]: [] },
          hasMoreByConversation: { ...s.hasMoreByConversation, [id]: false },
          conversations: withLastMessage(s.conversations, id, []),
        }));
      } catch (err) {
        toastError(err);
      }
    },

    clearContext: async (id) => {
      try {
        await apiClearContext(id);
      } catch (err) {
        toastError(err);
      }
    },

    // ✅ 发送 → 乐观追加我方消息 → 流式按行产生临时气泡 → 流结束后重拉该会话消息
    sendMessage: async (text) => {
      const conversationId = get().activeConversationId;
      // 同一时刻只允许一条回复在进行
      if (conversationId === null || get().streaming !== null) return;
      const controller = new AbortController();
      const optimistic: Message = {
        id: -Date.now(), // 负数临时 id，重拉后被真实消息替换
        side: 'mine',
        text,
        status: 'completed',
        created_at: new Date().toISOString(),
      };
      set((s) => {
        const messages = [...(s.messagesByConversation[conversationId] ?? []), optimistic];
        return {
          messagesByConversation: { ...s.messagesByConversation, [conversationId]: messages },
          // 子卡预览立即显示刚发出的消息，不等流结束
          conversations: withLastMessage(s.conversations, conversationId, messages),
          streaming: { conversationId, bubbles: [], pending: true, controller },
        };
      });

      /** 追加临时气泡；⚠️ 只通过 set 的最新状态写入，不捕获外层 streaming 对象 */
      const pushBubbles = (lines: string[]) => {
        if (lines.length === 0) return;
        set((s) =>
          s.streaming === null
            ? s
            : { streaming: { ...s.streaming, bubbles: [...s.streaming.bubbles, ...lines] } },
        );
      };
      // 跨 delta 的未完成行
      let carry = '';
      try {
        await streamSse(
          `/conversations/${conversationId}/chat`,
          { text },
          {
            signal: controller.signal,
            token: tokenStorage.get(),
            onDelta: (delta) => {
              const { lines, rest } = takeCompletedLines(carry + delta);
              carry = rest;
              pushBubbles(lines);
            },
            onError: (message) => {
              carry = '';
              pushBubbles([`[错误: ${message}]`]);
            },
            onDone: () => {
              // [DONE] 后剩余非空文本作为最后一个气泡；用户已请求停止时后端丢弃了这段半行，这里同样不显示
              const last = carry.trim();
              carry = '';
              if (last !== '' && get().streaming?.pending === true) pushBubbles([last]);
            },
          },
        );
      } catch (err) {
        // 非 2xx（如 429 今日额度已用完）或网络错误；后端未保存消息，重拉会移除乐观消息
        toastError(err);
      }
      // 先关掉加载气泡，bubbles 保留到重拉完成
      set((s) => (s.streaming === null ? s : { streaming: { ...s.streaming, pending: false } }));
      // reset()（退出登录 / 删除全部对话）已中止本次回复并清空 streaming：这段会话不再属于当前状态，不重拉
      if (get().streaming === null) return;
      // ⚠️ 走到这里服务端一定已落库：[DONE] 在后端 finally 之后才发，stopGeneration 也在 stop 返回后才 abort；
      // 持久化结果与 streaming=null 在同一次 set 里落地，列表不会渲染"临时气泡 + 持久化消息"并存的中间状态
      try {
        const page = await getMessages(conversationId);
        set((s) => {
          if (s.streaming === null) return s;
          const { messages, hasMore } = mergeLatest(
            s.messagesByConversation[conversationId],
            page,
            s.hasMoreByConversation[conversationId] ?? false,
          );
          return {
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: messages },
            hasMoreByConversation: { ...s.hasMoreByConversation, [conversationId]: hasMore },
            conversations: withLastMessage(s.conversations, conversationId, messages),
            streaming: null,
          };
        });
      } catch (err) {
        toastError(err);
        set({ streaming: null });
      }
    },

    // 💡 显式 stop 接口取代"abort 后立刻重拉"：服务端先落库再结束流，消除竞态，详见 docs/interview.md#abort-race
    stopGeneration: async () => {
      const streaming = get().streaming;
      // 没有回复在进行，或已经请求过停止
      if (streaming === null || !streaming.pending) return;
      // 立即收起加载气泡；之后到达的 [DONE] 不再把半行当作最后一个气泡
      set({ streaming: { ...streaming, pending: false } });
      try {
        await stopChat(streaming.conversationId);
      } catch (err) {
        toastError(err);
      }
      // stop 返回时服务端已落库并发出 [DONE]，本地 fetch 通常已自行结束；abort 兜底 stopped=false 的情况，
      // sendMessage 在流结束后重拉消息
      streaming.controller.abort();
    },

    forgetMessages: () => set({ messagesByConversation: {}, hasMoreByConversation: {} }),

    reset: () => {
      get().streaming?.controller.abort();
      set(INITIAL);
    },
  };
});

// 用户切换时清掉会话、消息与选中状态，并中止进行中的回复流
onUserSwitch(() => useChatStore.getState().reset());
