/**
 * @file 聊天数据层：会话列表、按会话缓存的消息、选中/折叠状态，以及 AI 流式回复。
 * 流式回复期间用 streaming.bubbles 逐行暂存 AI 气泡，结束后重新拉取该会话消息替换。
 * 所有动作失败时自行 toast，不向调用方 reject（网络与鉴权是唯一的错误边界）。
 */
import { create } from 'zustand';
import { toastError } from '@/components/toastStore';
import { CHARACTERS } from '@/constants/characters';
import { API_BASE, tokenStorage } from '@/lib/http';
import { streamSse, takeCompletedLines } from '@/lib/sse';
import {
  clearContext as apiClearContext,
  clearMessages as apiClearMessages,
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getConversations,
  getMessages,
  type Conversation,
  type Message,
} from '@/features/chat/api';

/** 进行中的 AI 回复 */
export interface StreamingState {
  /** 目标会话；用户切到别的会话时，回复仍写回这里 */
  conversationId: number;
  /** 已收完整的行，每行一个临时气泡 */
  bubbles: string[];
  /** 请求仍在进行（显示加载气泡）；流结束到消息重拉完成之间为 false，bubbles 仍保留 */
  pending: boolean;
  controller: AbortController;
}

/** 聊天 store */
export interface ChatState {
  conversations: Conversation[];
  /** 会话 id → 消息；未加载过的会话没有键 */
  messagesByConversation: Record<number, Message[]>;
  activeConversationId: number | null;
  /** 选中的主卡（常显白色遮罩）；点主卡或选子卡都会设置 */
  activeCharacterName: string | null;
  /** 角色名 → 是否折叠，默认全部折叠 */
  collapsedCharacters: Record<string, boolean>;
  streaming: StreamingState | null;

  /** 拉取全部会话 */
  loadConversations: () => Promise<void>;
  /** 选中会话并拉取其消息，同时选中所属主卡 */
  selectConversation: (id: number) => Promise<void>;
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
  /** 中止当前回复；已显示的行保留到消息重拉 */
  stopGeneration: () => void;
  /** 丢弃本地消息缓存（数据管理"清空全部消息"后） */
  forgetMessages: () => void;
  /** 清空选中与消息缓存并重拉会话（数据管理"删除全部对话"后） */
  reset: () => Promise<void>;
}

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

/** 聊天数据层 */
export const useChatStore = create<ChatState>()((set, get) => {
  /** 拉取某会话消息并同步它的预览 */
  async function reloadMessages(id: number): Promise<void> {
    const messages = await getMessages(id);
    set((s) => ({
      messagesByConversation: { ...s.messagesByConversation, [id]: messages },
      conversations: withLastMessage(s.conversations, id, messages),
    }));
  }

  return {
    conversations: [],
    messagesByConversation: {},
    activeConversationId: null,
    activeCharacterName: null,
    collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
    streaming: null,

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
        return;
      }
      set((s) => {
        const removed = s.conversations.find((c) => c.id === id);
        const conversations = s.conversations.filter((c) => c.id !== id);
        const messagesByConversation = { ...s.messagesByConversation };
        delete messagesByConversation[id];
        if (removed === undefined || s.activeConversationId !== id) {
          return { conversations, messagesByConversation };
        }
        // 删的是当前会话：改选同角色中原位置的下一个，没有则上一个
        const siblings = conversations.filter((c) => c.character_name === removed.character_name);
        const oldIndex = s.conversations
          .filter((c) => c.character_name === removed.character_name)
          .findIndex((c) => c.id === id);
        const next = siblings[Math.min(oldIndex, siblings.length - 1)];
        return { conversations, messagesByConversation, activeConversationId: next.id };
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

    // ✅ 发送 → 乐观追加我方消息 → 流式按行产生临时气泡 → 结束后重拉该会话消息
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
      set((s) => ({
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: [...(s.messagesByConversation[conversationId] ?? []), optimistic],
        },
        streaming: { conversationId, bubbles: [], pending: true, controller },
      }));

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
          `${API_BASE}/conversations/${conversationId}/chat`,
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
              // [DONE] 后剩余非空文本作为最后一个气泡
              const last = carry.trim();
              carry = '';
              if (last !== '') pushBubbles([last]);
            },
          },
        );
      } catch (err) {
        // 非 2xx（如 429 今日额度已用完）或网络错误；后端未保存消息，重拉会移除乐观消息
        toastError(err);
      }
      // ⚠️ 中断：半行丢弃，已显示的行直接留作本地 aborted 消息。后端要到下一次写入时才察觉断开并持久化这些行，
      // 立刻重拉会拿不到它们而让气泡消失；下次重拉（切换会话、下一条回复）再与服务端对齐
      if (controller.signal.aborted) {
        const now = Date.now();
        const kept: Message[] = get().streaming!.bubbles.map((line, i) => ({
          id: -now - i - 1,
          side: 'other',
          text: line,
          status: 'aborted',
          created_at: new Date(now).toISOString(),
        }));
        set((s) => {
          const messages = [...(s.messagesByConversation[conversationId] ?? []), ...kept];
          return {
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: messages },
            conversations: withLastMessage(s.conversations, conversationId, messages),
            streaming: null,
          };
        });
        return;
      }
      // 流正常结束或出错：先关掉加载气泡，bubbles 保留到重拉完成
      set((s) => (s.streaming === null ? s : { streaming: { ...s.streaming, pending: false } }));
      // 持久化结果与 streaming=null 在同一次 set 里落地，列表不会渲染"临时气泡 + 持久化消息"并存的中间状态
      try {
        const messages = await getMessages(conversationId);
        set((s) => ({
          messagesByConversation: { ...s.messagesByConversation, [conversationId]: messages },
          conversations: withLastMessage(s.conversations, conversationId, messages),
          streaming: null,
        }));
      } catch (err) {
        toastError(err);
        set({ streaming: null });
      }
    },

    stopGeneration: () => {
      get().streaming?.controller.abort();
    },

    forgetMessages: () => set({ messagesByConversation: {} }),

    reset: async () => {
      set({ activeConversationId: null, activeCharacterName: null, messagesByConversation: {} });
      await get().loadConversations();
    },
  };
});
