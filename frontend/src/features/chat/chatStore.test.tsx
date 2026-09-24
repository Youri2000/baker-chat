/**
 * @file chatStore 流式测试：delta 逐行产生 bubbles、[DONE] 后重拉、abort 后 bubbles 保留到重拉、
 * 切换会话后流仍写回原会话；以及选中/折叠的基础行为。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import { useChatStore } from '@/features/chat/chatStore';
import type { Conversation, Message } from '@/features/chat/api';
import { tokenStorage } from '@/lib/http';
import { flush, jsonResponse, mockFetch, sseResponse, type SseHandle } from '@/test/mockFetch';

/** 两个会话：陈千语(1)、洛茜(2) */
const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
  { id: 2, character_name: '洛茜', last_message: null, created_at: '', updated_at: '' },
];

/** 一条持久化消息 */
function msg(id: number, side: Message['side'], text: string): Message {
  return { id, side, text, status: 'completed', created_at: '' };
}

/**
 * 桩：会话列表、消息（可被替换）、chat 走可控 SSE。
 * 返回 SSE 句柄与"设置重拉时返回的消息"的函数。
 */
function setupServer(): { sse: SseHandle; setMessages: (id: number, list: Message[]) => void } {
  const sse = sseResponse();
  const messages: Record<number, Message[]> = { 1: [], 2: [] };
  mockFetch((req) => {
    if (req.path === '/api/conversations') return jsonResponse(CONVERSATIONS);
    const m = /^\/api\/conversations\/(\d+)\/(messages|chat)$/.exec(req.path);
    if (m?.[2] === 'messages') return jsonResponse(messages[Number(m[1])]);
    if (m?.[2] === 'chat') return sse.response;
    return jsonResponse({ detail: 'not found' }, 404);
  });
  return {
    sse,
    setMessages: (id, list) => {
      messages[id] = list;
    },
  };
}

describe('chatStore', () => {
  beforeEach(async () => {
    tokenStorage.set('jwt');
    useChatStore.setState({
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
      streaming: null,
    });
  });

  /** 默认全部折叠；点主卡切换折叠并选中 */
  it('toggleCharacter 切换折叠并设为选中主卡', () => {
    const store = useChatStore.getState();
    expect(store.collapsedCharacters['陈千语']).toBe(true);
    store.toggleCharacter('陈千语');
    expect(useChatStore.getState().collapsedCharacters['陈千语']).toBe(false);
    expect(useChatStore.getState().activeCharacterName).toBe('陈千语');
  });

  /** 选中会话：拉消息并选中所属主卡 */
  it('selectConversation 拉取消息并选中所属主卡', async () => {
    const { setMessages } = setupServer();
    setMessages(2, [msg(1, 'other', '你好')]);
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(2);
    const s = useChatStore.getState();
    expect(s.activeConversationId).toBe(2);
    expect(s.activeCharacterName).toBe('洛茜');
    expect(s.messagesByConversation[2]).toEqual([msg(1, 'other', '你好')]);
    expect(s.conversations[1].last_message).toEqual({ side: 'other', text: '你好' });
  });

  /** 每收完一整行就多一个气泡，半行留在缓冲 */
  it('sendMessage 在 delta 到达时逐行产生 bubbles', async () => {
    const { sse } = setupServer();
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    // 乐观追加我方消息 + 加载中
    expect(useChatStore.getState().messagesByConversation[1]).toMatchObject([
      { side: 'mine', text: '在吗' },
    ]);
    expect(useChatStore.getState().streaming).toMatchObject({
      conversationId: 1,
      bubbles: [],
      pending: true,
    });
    sse.push('data: {"delta":"第一行\\n第二"}\n\n');
    await flush();
    expect(useChatStore.getState().streaming?.bubbles).toEqual(['第一行']);
    sse.push('data: {"delta":"行\\n第三行"}\n\n');
    await flush();
    expect(useChatStore.getState().streaming?.bubbles).toEqual(['第一行', '第二行']);
    sse.push('data: [DONE]\n\n');
    await sending;
  });

  /** [DONE] 后剩余半行成为最后一个气泡，然后重拉消息替换临时气泡 */
  it('[DONE] 后重新拉取该会话消息并清空 streaming', async () => {
    const { sse, setMessages } = setupServer();
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    sse.push('data: {"delta":"第一行\\n第二行"}\n\n');
    await flush();
    // 重拉时后端已持久化 1 条我方 + 2 条对方
    setMessages(1, [
      msg(10, 'mine', '在吗'),
      msg(11, 'other', '第一行'),
      msg(12, 'other', '第二行'),
    ]);
    sse.push('data: [DONE]\n\n');
    await sending;
    const s = useChatStore.getState();
    expect(s.streaming).toBeNull();
    expect(s.messagesByConversation[1].map((m) => m.id)).toEqual([10, 11, 12]);
    expect(s.conversations[0].last_message).toEqual({ side: 'other', text: '第二行' });
  });

  /** 中断：已显示的行留作本地 aborted 消息且不重拉（后端要到下一次写入才持久化它们），半行丢弃 */
  it('stopGeneration 后已显示的行留作本地 aborted 消息且不重拉', async () => {
    const { sse } = setupServer();
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(1);
    const fetchMock = mockFetch((req) => {
      if (req.path === '/api/conversations/1/chat') return sse.response;
      return jsonResponse([]);
    });
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    sse.push('data: {"delta":"第一行\\n第二"}\n\n');
    await flush();
    useChatStore.getState().stopGeneration();
    // 真实 fetch 在 abort 后会让 read() 以 AbortError 拒绝；手写桩流不会，用一次继续推送唤醒读取，
    // 同时验证 abort 后的数据不再进入消息
    sse.push('data: {"delta":"行\\n第三行\\n"}\n\n');
    await sending;
    const s = useChatStore.getState();
    expect(s.streaming).toBeNull();
    // 第一行保留为 aborted，半行"第二"丢弃
    expect(s.messagesByConversation[1].map((m) => [m.side, m.text, m.status])).toEqual([
      ['mine', '在吗', 'completed'],
      ['other', '第一行', 'aborted'],
    ]);
    expect(s.conversations[0].last_message).toEqual({ side: 'other', text: '第一行' });
    // 中断后没有重拉消息
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/messages'))).toHaveLength(
      0,
    );
  });

  /** 切到洛茜后，陈千语的流继续写回会话 1，洛茜的消息不受影响 */
  it('切换会话后流仍写回原会话', async () => {
    const { sse, setMessages } = setupServer();
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    await useChatStore.getState().selectConversation(2);
    sse.push('data: {"delta":"回复\\n"}\n\n');
    await flush();
    expect(useChatStore.getState().activeConversationId).toBe(2);
    expect(useChatStore.getState().streaming).toMatchObject({
      conversationId: 1,
      bubbles: ['回复'],
    });
    setMessages(1, [msg(10, 'mine', '在吗'), msg(11, 'other', '回复')]);
    sse.push('data: [DONE]\n\n');
    await sending;
    const s = useChatStore.getState();
    expect(s.messagesByConversation[1].map((m) => m.text)).toEqual(['在吗', '回复']);
    expect(s.messagesByConversation[2]).toEqual([]);
    expect(s.conversations[0].last_message).toEqual({ side: 'other', text: '回复' });
    expect(s.conversations[1].last_message).toBeNull();
  });

  /** 错误帧显示为 [错误: …] 气泡 */
  it('错误帧产生 [错误: …] 气泡', async () => {
    const { sse } = setupServer();
    await useChatStore.getState().loadConversations();
    await useChatStore.getState().selectConversation(1);
    const sending = useChatStore.getState().sendMessage('在吗');
    await flush();
    sse.push('data: {"error":"上游响应超时"}\n\n');
    await flush();
    expect(useChatStore.getState().streaming?.bubbles).toEqual(['[错误: 上游响应超时]']);
    sse.push('data: [DONE]\n\n');
    await sending;
  });
});
