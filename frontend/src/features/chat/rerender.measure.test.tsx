/**
 * @file 度量用例：流式回复期间聊天区的 Profiler commit 次数与 ChatBubble 渲染次数，memo 版与去掉 memo 的对照版各跑一遍。
 * 场景：20 条历史消息 → chatStore.sendMessage 走真实的 fetch + SSE 解析路径，推送 30 帧 delta（每 3 帧凑成一行，共 10 行）
 * → [DONE] → 重拉持久化消息。每帧各自包在一次 act 里，与浏览器中"每个网络事件一次提交"的节奏一致。
 * jsdom 没有布局：ResizeObserver 桩不回调，气泡始终按加载尺寸绘制；真实浏览器里每个新气泡还会因测量结果多渲染自身一次，
 * 两组相同，不影响对比。LoadingBubble 的 rAF 展开也桩掉，避免一次时机不定的额外提交。
 * 断言只做宽松的"memo 版 ≤ 对照版"，具体数字打印到 stdout，并记录在 docs/notes/measurements.md。
 */
import { act, cleanup, render } from '@testing-library/react';
import { memo, Profiler, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message } from '@/features/chat/api';
import { ChatArea } from '@/features/chat/ChatArea';
import type { ChatBubbleProps } from '@/features/chat/ChatBubble';
import { useChatStore } from '@/features/chat/chatStore';
import type { Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch, sseResponse } from '@/test/mockFetch';

/** 渲染计数与 memo 开关；vi.mock 工厂会被提升到文件顶部，只能引用 vi.hoisted 的值 */
const probe = vi.hoisted(() => ({ memo: true, render: vi.fn() }));

// 用计数版替换 ChatBubble：memo 版包一层 memo，对照版直接渲染；两者内部都调用原组件函数
vi.mock('@/features/chat/ChatBubble', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/chat/ChatBubble')>();
  // memo 组件对象的 type 就是被包裹的原函数；React 类型把它声明为 NamedExoticComponent，需要断言
  const { type: renderOriginal } = original.ChatBubble as unknown as {
    type: (props: ChatBubbleProps) => ReactElement;
  };
  /** 计数后执行原组件（hooks 在本组件内运行） */
  function Counted(props: ChatBubbleProps) {
    probe.render();
    return renderOriginal(props);
  }
  const Memoized = memo(Counted);
  /** 按开关选择 memo 版或对照版 */
  function ChatBubble(props: ChatBubbleProps) {
    return probe.memo ? <Memoized {...props} /> : <Counted {...props} />;
  }
  return { ChatBubble };
});

/** jsdom 没有 ResizeObserver：桩实现不回调，气泡保持未测量状态 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
];

const SETTINGS: Settings = {
  temperature: 0.8,
  max_tokens: 2048,
  world_setting: '',
  world_setting_is_default: true,
  my_gender: 'male',
  strip_variant: 0,
  model: 'deepseek-flash',
  daily_limit: 100,
  daily_used: 0,
};

const HISTORY_COUNT = 20;
const LINE_COUNT = 10;
const FRAMES_PER_LINE = 3;
const QUESTION = '请用十行介绍一下你自己';

/** 一条持久化消息 */
function msg(id: number, side: Message['side'], text: string): Message {
  return { id, side, text, status: 'completed', created_at: '' };
}

/** 20 条历史：我方 / 对方交替 */
const HISTORY: Message[] = Array.from({ length: HISTORY_COUNT }, (_, i) =>
  msg(i + 1, i % 2 === 0 ? 'mine' : 'other', `历史消息 ${i + 1}`),
);

/** AI 回复的 10 行 */
const LINES = Array.from({ length: LINE_COUNT }, (_, i) => `这是流式回复的第 ${i + 1} 行`);

/** 30 帧 delta：每行切成 3 段，最后一段带换行，前端在每行的第 3 帧固化一个气泡 */
const FRAMES = LINES.flatMap((line) => {
  const step = Math.ceil(line.length / FRAMES_PER_LINE);
  return Array.from({ length: FRAMES_PER_LINE }, (_, k) => {
    const piece = line.slice(k * step, (k + 1) * step);
    const delta = k === FRAMES_PER_LINE - 1 ? `${piece}\n` : piece;
    return `data: ${JSON.stringify({ delta })}\n\n`;
  });
});

/** 流结束后重拉得到的持久化结果：历史 + 提问 + 10 行回复 */
const PERSISTED: Message[] = [
  ...HISTORY,
  msg(HISTORY_COUNT + 1, 'mine', QUESTION),
  ...LINES.map((text, i) => msg(HISTORY_COUNT + 2 + i, 'other', text)),
];

/** 一次场景的统计 */
interface Stats {
  /** Profiler onRender 次数（挂载 + 发送 + 每行 + 结束 + 重拉） */
  commits: number;
  /** 挂载 20 条历史时的 ChatBubble 渲染次数 */
  mountRenders: number;
  /** 发送到重拉完成期间的 ChatBubble 渲染次数 */
  streamRenders: number;
}

/** 跑一遍完整场景：挂载 → 发送 → 30 帧 → [DONE] → 重拉 */
async function runScenario(useMemo: boolean): Promise<Stats> {
  probe.memo = useMemo;
  probe.render.mockClear();
  useChatStore.setState({
    conversations: CONVERSATIONS,
    activeConversationId: 1,
    activeCharacterName: '陈千语',
    messagesByConversation: { 1: HISTORY },
    streaming: null,
  });
  useSettingsStore.setState({ settings: SETTINGS });

  const sse = sseResponse();
  // 重拉请求挂在 gate 上，让"关闭加载气泡"与"替换为持久化消息"像真实网络那样落在两次提交里
  let releaseMessages = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseMessages = resolve;
  });
  mockFetch(async (req) => {
    if (req.path.endsWith('/chat')) return sse.response;
    await gate;
    return jsonResponse(PERSISTED);
  });

  let commits = 0;
  render(
    <Profiler
      id="chat-area"
      onRender={() => {
        commits += 1;
      }}
    >
      <ChatArea />
    </Profiler>,
  );
  const mountRenders = probe.render.mock.calls.length;

  let sending!: Promise<void>;
  act(() => {
    sending = useChatStore.getState().sendMessage(QUESTION);
  });
  // ⚠️ 每帧一次 act：同一 act 内的多次 set 会被合并成一次提交，与真实的逐帧到达不符
  for (const frame of FRAMES) {
    await act(async () => sse.push(frame));
  }
  await act(async () => sse.push('data: [DONE]\n\n'));
  await act(async () => releaseMessages());
  await sending;
  cleanup();

  return { commits, mountRenders, streamRenders: probe.render.mock.calls.length - mountRenders };
}

describe('流式回复期间的重渲染次数', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    tokenStorage.set('jwt');
  });

  /** 同一场景下 memo 版的 ChatBubble 渲染次数不多于去掉 memo 的对照版；数字打印到 stdout */
  it('memo 版 ChatBubble 渲染次数 ≤ 对照版', async () => {
    const memoized = await runScenario(true);
    const control = await runScenario(false);

    console.log(
      [
        `场景：${HISTORY_COUNT} 条历史 + 发送 1 条 + ${FRAMES.length} 帧 delta（${LINE_COUNT} 行）+ [DONE] + 重拉`,
        '| 指标 | memo 版 | 对照版（去掉 memo） |',
        '| --- | --- | --- |',
        `| Profiler commit 次数 | ${memoized.commits} | ${control.commits} |`,
        `| ChatBubble 渲染：挂载 ${HISTORY_COUNT} 条历史 | ${memoized.mountRenders} | ${control.mountRenders} |`,
        `| ChatBubble 渲染：发送 → 重拉完成 | ${memoized.streamRenders} | ${control.streamRenders} |`,
      ].join('\n'),
    );

    expect(memoized.mountRenders).toBe(HISTORY_COUNT);
    expect(memoized.streamRenders).toBeLessThanOrEqual(control.streamRenders);
    expect(memoized.commits).toBeLessThanOrEqual(control.commits);
  });
});
