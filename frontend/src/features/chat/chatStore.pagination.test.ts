/**
 * @file chatStore 消息分页测试：桩服务端按 before_id 与默认每页 50 条返回 {items, has_more}。
 * 覆盖：打开会话只取最近一页、加载更早历史插到前面直到没有更多、同一时刻只有一次加载、加载期间会话被重新打开则丢弃该页、
 * 回复结束后最新一页与已加载的更早历史合并、回复超过一页时只保留最新一页（中间可能缺消息）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import type { Conversation, Message } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { tokenStorage } from '@/lib/http';
import { flush, jsonResponse, mockFetch, sseResponse } from '@/test/mockFetch';

/** 每页条数（与后端默认值一致） */
const PAGE = 50;

/** 会话 1：陈千语 */
const CONVERSATION: Conversation = {
  id: 1,
  character_name: '陈千语',
  last_message: null,
  created_at: '',
  updated_at: '',
};

/** 一条持久化消息，奇数 id 为我方 */
function msg(id: number): Message {
  return {
    id,
    side: id % 2 === 1 ? 'mine' : 'other',
    text: `第 ${id} 条`,
    status: 'completed',
    created_at: '',
  };
}

/** 连续 id 的消息 */
function range(from: number, to: number): Message[] {
  return Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
}

/** 桩服务端：messages 可被替换；请求记录 before_id（没有则为 null） */
function setupServer(initial: Message[]) {
  const state = {
    messages: initial,
    requests: [] as Array<number | null>,
    release: null as (() => void) | null,
  };
  const sse = sseResponse();
  mockFetch(async (req) => {
    if (req.path === '/api/conversations/1/chat') return sse.response;
    if (req.path !== '/api/conversations/1/messages')
      return jsonResponse({ detail: 'not found' }, 404);
    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(
      -1,
    )!;
    const beforeId = new URL(String(call[0])).searchParams.get('before_id');
    state.requests.push(beforeId === null ? null : Number(beforeId));
    if (state.release !== null) await new Promise<void>((resolve) => (state.release = resolve));
    const older = state.messages.filter((m) => beforeId === null || m.id < Number(beforeId));
    const items = older.slice(-PAGE);
    return jsonResponse({ items, has_more: older.length > items.length });
  });
  return { state, sse };
}

/** 当前会话 1 已加载消息的 id */
function loadedIds(): number[] {
  return (useChatStore.getState().messagesByConversation[1] ?? []).map((m) => m.id);
}

describe('chatStore 消息分页', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useChatStore.setState({
      conversations: [CONVERSATION],
      messagesByConversation: {},
      hasMoreByConversation: {},
      loadingEarlierId: null,
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
      streaming: null,
    });
  });

  /** 120 条消息：打开会话只取最近 50 条（71–120），还有更早的 */
  it('打开会话只拉取最近一页', async () => {
    const { state } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    expect(loadedIds()).toEqual(range(71, 120).map((m) => m.id));
    expect(useChatStore.getState().hasMoreByConversation[1]).toBe(true);
    expect(state.requests).toEqual([null]);
  });

  /** 依次加载更早两页：21–70、1–20 插到前面；没有更多后不再请求 */
  it('加载更早历史插到前面直到没有更多', async () => {
    const { state } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    await useChatStore.getState().loadEarlierMessages(1);
    expect(loadedIds()).toEqual(range(21, 120).map((m) => m.id));
    await useChatStore.getState().loadEarlierMessages(1);
    expect(loadedIds()).toEqual(range(1, 120).map((m) => m.id));
    expect(useChatStore.getState().hasMoreByConversation[1]).toBe(false);
    await useChatStore.getState().loadEarlierMessages(1);
    expect(state.requests).toEqual([null, 71, 21]);
  });

  /** 加载进行中再次触发：只发一次请求；进行中 loadingEarlierId 指向该会话，结束后清空 */
  it('同一时刻只进行一次加载', async () => {
    const { state } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    const first = useChatStore.getState().loadEarlierMessages(1);
    const second = useChatStore.getState().loadEarlierMessages(1);
    expect(useChatStore.getState().loadingEarlierId).toBe(1);
    await Promise.all([first, second]);
    expect(state.requests).toEqual([null, 71]);
    expect(useChatStore.getState().loadingEarlierId).toBeNull();
  });

  /** 加载更早一页期间会话被重新打开（又从最近一页开始）：更早那页不插入 */
  it('加载期间会话被重新打开则丢弃该页', async () => {
    const { state } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    state.release = () => {};
    const loading = useChatStore.getState().loadEarlierMessages(1);
    await flush();
    const pending = state.release;
    // 服务端新增 121–130，重新打开会话后最近一页变成 81–130
    state.messages = range(1, 130);
    state.release = null;
    await useChatStore.getState().selectConversation(1);
    pending();
    await loading;
    expect(loadedIds()).toEqual(range(81, 130).map((m) => m.id));
    expect(useChatStore.getState().loadingEarlierId).toBeNull();
  });

  /** 已加载 21–120，回复后服务端有 1–124：最新一页 75–124 与已加载的 21–74 合并，乐观消息去掉，仍有更早的 */
  it('回复结束后最新一页与已加载的更早历史合并', async () => {
    const { state, sse } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    await useChatStore.getState().loadEarlierMessages(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    expect(loadedIds().at(-1)).toBeLessThan(0);
    state.messages = range(1, 124);
    sse.push('data: [DONE]\n\n');
    sse.close();
    await sending;
    expect(loadedIds()).toEqual(range(21, 124).map((m) => m.id));
    expect(useChatStore.getState().hasMoreByConversation[1]).toBe(true);
    expect(useChatStore.getState().conversations[0].last_message?.text).toBe('第 124 条');
  });

  /** 已加载 71–120，一次回复新增 60 条（121–180）：最新一页 131–180 与已加载的不重叠，只保留最新一页 */
  it('回复超过一页时只保留最新一页', async () => {
    const { state, sse } = setupServer(range(1, 120));
    await useChatStore.getState().selectConversation(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    state.messages = range(1, 180);
    sse.push('data: [DONE]\n\n');
    sse.close();
    await sending;
    expect(loadedIds()).toEqual(range(131, 180).map((m) => m.id));
    expect(useChatStore.getState().hasMoreByConversation[1]).toBe(true);
  });
});
