/**
 * @file chatStore 流式测试：delta 逐行产生 bubbles、[DONE] 后重拉、停止先 POST stop 再结束本地 fetch、
 * 切换会话后流仍写回原会话；以及选中/折叠的基础行为。
 */
import { beforeEach, describe, expect, it, type Mock } from 'vitest';
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

/** 桩服务端 */
interface Server {
  sse: SseHandle;
  fetchMock: Mock;
  /** 设置重拉时返回的消息 */
  setMessages: (id: number, list: Message[]) => void;
  /** 请求路径序列（去掉 /api/conversations/1/ 前缀），用于断言 stop 与重拉的顺序 */
  paths: () => string[];
}

/**
 * 桩：会话列表、消息（可被替换）、chat 走可控 SSE、chat/stop 交给 onStop 决定结果。
 * onStop 默认回答"没有活动流"。
 */
function setupServer(onStop: () => { stopped: boolean } = () => ({ stopped: false })): Server {
  const sse = sseResponse();
  const messages: Record<number, Message[]> = { 1: [], 2: [] };
  const fetchMock = mockFetch((req) => {
    if (req.path === '/api/conversations') return jsonResponse(CONVERSATIONS);
    const m = /^\/api\/conversations\/(\d+)\/(messages|chat|chat\/stop)$/.exec(req.path);
    if (m?.[2] === 'messages') return jsonResponse(messages[Number(m[1])]);
    if (m?.[2] === 'chat') return sse.response;
    if (m?.[2] === 'chat/stop') return jsonResponse(onStop());
    return jsonResponse({ detail: 'not found' }, 404);
  });
  return {
    sse,
    fetchMock,
    setMessages: (id, list) => {
      messages[id] = list;
    },
    paths: () =>
      fetchMock.mock.calls
        .map(([url]) => String(url).replace('http://backend.test/api/conversations/1/', ''))
        .filter((p) => !p.startsWith('http')),
  };
}

/** 加载会话、选中会话 1 并发送"在吗"，推送一帧含半行的 delta；sending 用对象包一层，避免被 async 函数展平 */
async function startStreaming(server: Server): Promise<{ sending: Promise<void> }> {
  await useChatStore.getState().loadConversations();
  await useChatStore.getState().selectConversation(1);
  const sending = useChatStore.getState().sendMessage('在吗');
  await flush();
  server.sse.push('data: {"delta":"第一行\\n第二"}\n\n');
  await flush();
  expect(useChatStore.getState().streaming?.bubbles).toEqual(['第一行']);
  return { sending };
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

  /**
   * 停止：点击即收起加载气泡；POST stop 时服务端按中断规则落库（半行"第二"丢弃）并以 [DONE] 结束流，
   * 之后重拉用持久化结果替换临时气泡；半行从未成为气泡，且只在 stop 之后重拉一次
   */
  it('stopGeneration 先 POST stop，流以 [DONE] 结束后重拉，半行不显示', async () => {
    const server = setupServer(() => {
      server.setMessages(1, [
        msg(10, 'mine', '在吗'),
        { ...msg(11, 'other', '第一行'), status: 'aborted' },
      ]);
      server.sse.push('data: [DONE]\n\n');
      return { stopped: true };
    });
    const { sending } = await startStreaming(server);
    const shown = new Set<string>();
    const unsubscribe = useChatStore.subscribe((s) =>
      s.streaming?.bubbles.forEach((line) => shown.add(line)),
    );
    const stopping = useChatStore.getState().stopGeneration();
    expect(useChatStore.getState().streaming).toMatchObject({
      pending: false,
      bubbles: ['第一行'],
    });
    await stopping;
    await sending;
    unsubscribe();
    const s = useChatStore.getState();
    expect(s.streaming).toBeNull();
    expect(s.messagesByConversation[1].map((m) => [m.side, m.text, m.status])).toEqual([
      ['mine', '在吗', 'completed'],
      ['other', '第一行', 'aborted'],
    ]);
    expect(s.conversations[0].last_message).toEqual({ side: 'other', text: '第一行' });
    expect(shown).toEqual(new Set(['第一行']));
    expect(server.paths()).toEqual(['messages', 'chat', 'chat/stop', 'messages']);
  });

  /** 服务端没有活动流（stopped=false）：abort 结束本地 fetch，abort 后的数据不再进入气泡，随后重拉 */
  it('stopped=false 时靠 abort 结束本地 fetch 再重拉', async () => {
    const server = setupServer();
    const { sending } = await startStreaming(server);
    server.setMessages(1, [
      msg(10, 'mine', '在吗'),
      { ...msg(11, 'other', '第一行'), status: 'aborted' },
    ]);
    await useChatStore.getState().stopGeneration();
    // 真实 fetch 在 abort 后会让 read() 以 AbortError 拒绝；手写桩流不会，用一次继续推送唤醒读取
    server.sse.push('data: {"delta":"行\\n第三行\\n"}\n\n');
    await sending;
    const s = useChatStore.getState();
    expect(s.streaming).toBeNull();
    expect(s.messagesByConversation[1].map((m) => m.text)).toEqual(['在吗', '第一行']);
    expect(server.paths()).toEqual(['messages', 'chat', 'chat/stop', 'messages']);
  });

  /** 重复点击停止只发一次 stop */
  it('stopGeneration 重复调用只 POST 一次 stop', async () => {
    const server = setupServer(() => ({ stopped: true }));
    const { sending } = await startStreaming(server);
    const first = useChatStore.getState().stopGeneration();
    await useChatStore.getState().stopGeneration();
    await first;
    server.sse.push('data: [DONE]\n\n');
    await sending;
    expect(server.paths().filter((p) => p === 'chat/stop')).toHaveLength(1);
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
