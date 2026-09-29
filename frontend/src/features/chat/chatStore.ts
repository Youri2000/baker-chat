/**
 * @file 聊天数据层：会话列表、按会话缓存的消息、选中/折叠状态，以及 AI 流式回复。
 * 消息分页加载：打开会话只取最近一页，滚到顶部附近再取更早的一页插到前面；
 * 流式回复期间用 streaming.bubbles 暂存 AI 气泡：打字机开启时按 typewriter.ts 的节奏逐字写出，关闭时整行出现；
 * 内容全部显示后重新拉取最新一页，与已加载的更早历史合并。
 * 停止生成先把界面收成与落库一致的内容，再走后端 /chat/stop（它返回时服务端已落库并以 [DONE] 结束流），
 * 本地 AbortController 只兜底结束 fetch。
 * 所有动作失败时自行 toast，不向调用方 reject（网络与鉴权是唯一的错误边界）。
 */
import { create } from 'zustand';
import { toastError } from '@/components/toastStore';
import { CHARACTERS } from '@/constants/characters';
import { ApiError, tokenStorage } from '@/lib/http';
import { streamSse } from '@/lib/sse';
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
import {
  INITIAL_TYPEWRITER,
  lineView,
  readSource,
  step,
  view,
  type TypewriterView,
} from '@/features/chat/typewriter';

/** 进行中的 AI 回复 */
export interface StreamingState {
  /** 目标会话；用户切到别的会话时，回复仍写回这里 */
  conversationId: number;
  /** 当前可见的行，每行一个临时气泡；打字机开启时最后一个可能是正在写的前缀 */
  bubbles: string[];
  /** 最后一个临时气泡还在写（尺寸会继续变化，不写入尺寸缓存） */
  typing: boolean;
  /** 显示加载气泡：首个字前、行间停顿、等待下一行；内容全部显示后到消息重拉完成之间为 false，bubbles 仍保留 */
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
  /** 向当前会话发送消息并流式接收回复；typewriter 为 true 时逐字写出（系统减少动态效果时仍整行显示） */
  sendMessage: (text: string, typewriter: boolean) => Promise<void>;
  /**
   * 停止当前回复：界面立即显示与落库一致的行（流未结束时只保留已收完整的行），再让后端落库并结束流、结束本地 fetch；
   * 流已结束、只是还没写完时直接显示剩余的行
   */
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

/** 逐字推进的时间步长（毫秒） */
const TICK_MS = 16;

/** 系统是否开启了"减少动态效果" */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** 一次回复的显示驱动；由 sendMessage 创建，stopGeneration 与 reset 通过它收尾 */
interface ReplyDisplay {
  /** 内容全部显示（写完、停止、出错或取消）时兑现 */
  finished: Promise<void>;
  /** 收到一段增量文本 */
  receive: (delta: string) => void;
  /** 流结束（[DONE] 或读取结束）：剩余内容照常写完 */
  end: () => void;
  /** 上游出错：已收到的全部文本立即按行显示，随后显示错误气泡 */
  fail: (message: string) => void;
  /** 停止：立即显示与落库一致的行；返回流是否仍在进行（需要请求后端停止） */
  stop: () => boolean;
  /** 取消：不再更新界面（reset 时用） */
  cancel: () => void;
}

/** 两次可见内容是否相同，相同就不写 store */
function sameView(a: TypewriterView, b: TypewriterView): boolean {
  return (
    a.typing === b.typing &&
    a.loading === b.loading &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => line === b.lines[i])
  );
}

/**
 * ✅ 创建一次回复的显示驱动：累积收到的文本，打字机开启时每 TICK_MS 按 typewriter.ts 推进一次进度，
 * 关闭时只显示完整的行；可见内容变化才调用 onView
 */
function createReplyDisplay(
  typewriter: boolean,
  onView: (view: TypewriterView) => void,
): ReplyDisplay {
  let received = '';
  let done = false;
  let over = false;
  let state = INITIAL_TYPEWRITER;
  let last = performance.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 与 sendMessage 写入的初始 streaming 一致：内容没变时不重复写 store
  let shown: TypewriterView = { lines: [], typing: false, loading: true };
  let resolveFinished = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  /** 可见内容变化时交给 onView */
  function emit(next: TypewriterView) {
    if (sameView(shown, next)) return;
    shown = next;
    onView(next);
  }

  /** 结束驱动：停掉计时器并兑现 finished */
  function finish() {
    over = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    resolveFinished();
  }

  /** 把进度推进到当前时刻（新内容登记之前调用，空闲时间不会攒成出字额度） */
  function advance() {
    const now = performance.now();
    state = step(state, readSource(received, done), now - last);
    last = now;
  }

  /** 按当前进度更新界面，还有要写的内容就安排下一次推进 */
  function render() {
    const source = readSource(received, done);
    if (!typewriter) {
      emit(lineView(source));
      if (done) finish();
      return;
    }
    state = step(state, source, 0);
    emit(view(state, source));
    if (state.finished) finish();
    else if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        advance();
        render();
      }, TICK_MS);
    }
  }

  return {
    finished,
    receive: (delta) => {
      if (over) return;
      if (typewriter) advance();
      received += delta;
      render();
    },
    end: () => {
      if (over) return;
      if (typewriter) advance();
      done = true;
      render();
    },
    fail: (message) => {
      if (over) return;
      const lines = readSource(received, true).lines.map((units) => units.join(''));
      emit({ lines: [...lines, `[错误: ${message}]`], typing: false, loading: false });
      finish();
    },
    stop: () => {
      if (over) return false;
      const source = readSource(received, done);
      emit({ ...lineView(source), loading: false });
      finish();
      return !done;
    },
    cancel: () => {
      if (!over) finish();
    },
  };
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
  /** 进行中回复的显示驱动；同一时刻最多一个 */
  let activeReply: ReplyDisplay | null = null;

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

    // ✅ 发送 → 乐观追加我方消息 → 流式逐字（或整行）显示临时气泡 → 内容全部显示后重拉该会话消息
    sendMessage: async (text, typewriter) => {
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
          streaming: { conversationId, bubbles: [], typing: false, pending: true, controller },
        };
      });

      // ⚠️ 只写回本次回复自己的 streaming：reset 后发起的新回复有新的 controller，旧驱动的迟到更新不能串进去
      const reply = createReplyDisplay(typewriter && !prefersReducedMotion(), (next) =>
        set((s) =>
          s.streaming?.controller !== controller
            ? s
            : {
                streaming: {
                  ...s.streaming,
                  bubbles: next.lines,
                  typing: next.typing,
                  pending: next.loading,
                },
              },
        ),
      );
      activeReply = reply;
      let failed = false;
      try {
        await streamSse(
          `/conversations/${conversationId}/chat`,
          { text },
          {
            signal: controller.signal,
            token: tokenStorage.get(),
            onDelta: (delta) => reply.receive(delta),
            onError: (message) => reply.fail(message),
            onDone: () => reply.end(),
          },
        );
      } catch (err) {
        // 非 2xx（如 429 今日额度已用完）或网络错误；后端未保存或按中断落库（丢弃半行），与停止同样收尾
        failed = true;
        toastError(err);
      }
      if (failed) reply.stop();
      else reply.end();
      // 打字机开启时流结束后还要把剩余内容写完；这段时间仍算回复中，停止按钮可用
      await reply.finished;
      if (activeReply === reply) activeReply = null;
      // 内容已全部显示：关掉加载气泡，bubbles 保留到重拉完成（驱动收尾时通常已关掉，已关就不再写 store）
      set((s) =>
        s.streaming?.controller !== controller || (!s.streaming.pending && !s.streaming.typing)
          ? s
          : { streaming: { ...s.streaming, typing: false, pending: false } },
      );
      // reset()（退出登录 / 删除全部对话）已中止本次回复并清空 streaming，之后还可能开始了新的回复：
      // 这段回复不再属于当前状态，不重拉
      if (get().streaming?.controller !== controller) return;
      // ⚠️ 走到这里服务端一定已落库：[DONE] 在后端 finally 之后才发，stopGeneration 也在 stop 返回后才 abort；
      // 持久化结果与 streaming=null 在同一次 set 里落地，列表不会渲染"临时气泡 + 持久化消息"并存的中间状态
      try {
        const page = await getMessages(conversationId);
        set((s) => {
          if (s.streaming?.controller !== controller) return s;
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
        set((s) => (s.streaming?.controller !== controller ? s : { streaming: null }));
      }
    },

    // 💡 显式 stop 接口取代"abort 后立刻重拉"：服务端先落库再结束流，消除竞态，详见 docs/interview.md#abort-race
    stopGeneration: async () => {
      const streaming = get().streaming;
      const reply = activeReply;
      // 没有回复在进行，或已经请求过停止
      if (streaming === null || reply === null) return;
      activeReply = null;
      // 立即显示与落库一致的行并收起加载气泡；之后到达的内容与 [DONE] 都被驱动忽略
      const streamActive = reply.stop();
      // 流已结束、只是还没写完：没有要停止的请求，sendMessage 接着重拉
      if (!streamActive) return;
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
      activeReply?.cancel();
      activeReply = null;
      get().streaming?.controller.abort();
      set(INITIAL);
    },
  };
});

// 用户切换时清掉会话、消息与选中状态，并中止进行中的回复流
onUserSwitch(() => useChatStore.getState().reset());
