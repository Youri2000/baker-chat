/**
 * @file chatStore 打字机模式测试：逐字写出与行间停顿、流结束后写完才重拉、写字期间停止（流未结束 / 已结束）、
 * 错误帧立即显示已收到的全部内容、系统"减少动态效果"时整行显示、reset 停掉计时器。
 * 用假计时器（含 performance.now）推进时间；网络仍走真实的 fetch + SSE 解析路径（mockFetch）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import type { Conversation, Message } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch, sseResponse, type SseHandle } from '@/test/mockFetch';

const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
];

/** 一条持久化消息 */
function msg(id: number, side: Message['side'], text: string): Message {
  return { id, side, text, status: 'completed', created_at: '' };
}

/** 桩服务端：chat 走可控 SSE，messages 返回可替换的列表，记录请求路径 */
function setupServer() {
  const sse: SseHandle = sseResponse();
  let persisted: Message[] = [];
  const fetchMock = mockFetch((req) => {
    if (req.path === '/api/conversations') return jsonResponse(CONVERSATIONS);
    if (req.path.endsWith('/messages')) return jsonResponse({ items: persisted, has_more: false });
    if (req.path.endsWith('/chat')) return sse.response;
    if (req.path.endsWith('/chat/stop')) return jsonResponse({ stopped: true });
    return jsonResponse({ detail: 'not found' }, 404);
  });
  return {
    sse,
    setPersisted: (list: Message[]) => {
      persisted = list;
    },
    paths: () =>
      fetchMock.mock.calls
        .map(([url]) => String(url).replace('http://backend.test/api/conversations/1/', ''))
        .filter((p) => !p.startsWith('http')),
  };
}

/** 推一帧 delta */
function delta(sse: SseHandle, text: string) {
  sse.push(`data: ${JSON.stringify({ delta: text })}\n\n`);
}

/** 结束流：[DONE] 后服务端关闭连接 */
function done(sse: SseHandle) {
  sse.push('data: [DONE]\n\n');
  sse.close();
}

/** 推进假时间并跑完期间的微任务 */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** 当前流式状态的可见部分 */
function snapshot() {
  const s = useChatStore.getState().streaming;
  return s === null ? null : { bubbles: s.bubbles, typing: s.typing, pending: s.pending };
}

/** 选中会话 1 并发送"在吗" */
async function send(typewriter = true) {
  await useChatStore.getState().loadConversations();
  await useChatStore.getState().selectConversation(1);
  const sending = useChatStore.getState().sendMessage('在吗', typewriter);
  await wait(0);
  return { sending };
}

describe('chatStore 打字机模式', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
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

  afterEach(() => {
    useChatStore.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 逐字写出第一行 → 停顿并显示加载气泡 → 新气泡写第二行；流结束后写完才重拉 */
  it('逐字写出、行间停顿，写完后重拉', async () => {
    const server = setupServer();
    const { sending } = await send();
    expect(snapshot()).toEqual({ bubbles: [], typing: false, pending: true });

    delta(server.sse, '第一行\n第二');
    // 约每秒 40 字：第一个字在 25ms 时攒够，16ms 一次推进，32ms 时出现；气泡正在写、没有加载气泡
    await wait(40);
    expect(snapshot()).toEqual({ bubbles: ['第'], typing: true, pending: false });
    // 约 75ms 写完第一行，随后停顿 0.5 秒：只有第一行和加载气泡
    await wait(60);
    expect(snapshot()).toEqual({ bubbles: ['第一行'], typing: false, pending: true });
    await wait(300);
    expect(snapshot()).toEqual({ bubbles: ['第一行'], typing: false, pending: true });
    // 停顿约在 575ms 结束，新气泡写出已到达的"第二"，等后续内容
    await wait(300);
    expect(snapshot()).toEqual({ bubbles: ['第一行', '第二'], typing: true, pending: false });

    delta(server.sse, '行\n第三行');
    done(server.sse);
    server.setPersisted([
      msg(1, 'mine', '在吗'),
      ...['第一行', '第二行', '第三行'].map((t, i) => msg(i + 2, 'other', t)),
    ]);
    await wait(100);
    // 流已结束但还没写完：仍在回复中，不重拉
    expect(snapshot()?.bubbles[1]).toBe('第二行');
    expect(server.paths()).toEqual(['messages', 'chat']);

    await wait(3000);
    await sending;
    expect(useChatStore.getState().streaming).toBeNull();
    expect(useChatStore.getState().messagesByConversation[1].map((m) => m.text)).toEqual([
      '在吗',
      '第一行',
      '第二行',
      '第三行',
    ]);
    expect(server.paths()).toEqual(['messages', 'chat', 'messages']);
  });

  /** 流未结束时停止：已收完整的两行立即完整显示，半行消失，先 POST stop 再重拉 */
  it('写字期间停止：完整的行立即显示，半行消失', async () => {
    const server = setupServer();
    const { sending } = await send();
    delta(server.sse, '甲乙丙\n丁戊\n己');
    await wait(40);
    expect(snapshot()?.bubbles).toEqual(['甲']);

    const stopping = useChatStore.getState().stopGeneration();
    expect(snapshot()).toEqual({ bubbles: ['甲乙丙', '丁戊'], typing: false, pending: false });
    await wait(0);
    // 服务端落库后以 [DONE] 结束流
    done(server.sse);
    await stopping;
    await wait(0);
    await sending;
    expect(server.paths()).toEqual(['messages', 'chat', 'chat/stop', 'messages']);
  });

  /** 流已结束、只是还没写完时停止：剩余的行全部立即显示，不再请求后端停止 */
  it('流结束后写字期间停止：剩余内容立即显示', async () => {
    const server = setupServer();
    const { sending } = await send();
    delta(server.sse, '甲乙\n丙丁');
    done(server.sse);
    await wait(40);
    expect(snapshot()?.typing).toBe(true);

    await useChatStore.getState().stopGeneration();
    expect(snapshot()).toEqual({ bubbles: ['甲乙', '丙丁'], typing: false, pending: false });
    await wait(0);
    await sending;
    expect(server.paths()).toEqual(['messages', 'chat', 'messages']);
  });

  /** 错误帧：已收到的全部文本（含没有换行的最后一段）立即按行显示，随后是错误气泡 */
  it('错误帧立即显示已收到的内容与错误气泡', async () => {
    const server = setupServer();
    const { sending } = await send();
    delta(server.sse, '第一行\n第二');
    await wait(20);
    server.sse.push(`data: ${JSON.stringify({ error: '上游认证失败（401）' })}\n\n`);
    await wait(0);
    expect(snapshot()).toEqual({
      bubbles: ['第一行', '第二', '[错误: 上游认证失败（401）]'],
      typing: false,
      pending: false,
    });
    done(server.sse);
    await wait(0);
    await sending;
    expect(useChatStore.getState().streaming).toBeNull();
  });

  /** 系统开启"减少动态效果"：即使开关开启也整行显示 */
  it('减少动态效果时整行显示', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList,
    );
    const server = setupServer();
    const { sending } = await send(true);
    delta(server.sse, '第一行\n第二');
    await wait(0);
    expect(snapshot()).toEqual({ bubbles: ['第一行'], typing: false, pending: true });
    done(server.sse);
    await wait(0);
    await sending;
  });

  /** 开关关闭：整行显示，流结束后剩余文本立即作为最后一个气泡 */
  it('关闭打字机时整行显示', async () => {
    const server = setupServer();
    const { sending } = await send(false);
    delta(server.sse, '第一行\n第二');
    await wait(0);
    expect(snapshot()).toEqual({ bubbles: ['第一行'], typing: false, pending: true });
    delta(server.sse, '行\n第三行');
    await wait(0);
    expect(snapshot()?.bubbles).toEqual(['第一行', '第二行']);
    done(server.sse);
    await wait(0);
    await sending;
    expect(server.paths()).toEqual(['messages', 'chat', 'messages']);
  });

  /** reset（退出登录等）：停掉打字计时器，之后不再写 store */
  it('reset 停掉打字计时器', async () => {
    const server = setupServer();
    const { sending } = await send();
    delta(server.sse, '字'.repeat(100));
    await wait(30);
    useChatStore.getState().reset();
    expect(useChatStore.getState().streaming).toBeNull();
    // 真实 fetch 被 abort 后读取随即结束；桩的响应不感知 abort，由测试关闭
    server.sse.close();
    await wait(0);
    await sending;
    expect(vi.getTimerCount()).toBe(0);
    await wait(2000);
    expect(useChatStore.getState().streaming).toBeNull();
  });
});
