/**
 * @file ChatArea 测试：空态文案；选中会话后显示角色名、消息与表情图片、头像显隐；点击聊天条循环样式并 PATCH；
 * 点击我方头像切换性别并 PATCH；PATCH 未返回时连点两次分别发 1、2 / female、male（基于最新值而不是渲染时的值）；
 * 流式期间只有流所属会话显示临时气泡与加载气泡，停止按钮始终可见；
 * 向上浏览时出现"回到底部"，新行到达后变为"有新消息"，点击平滑回底；我方发送时即使在浏览历史也回到底部。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatArea } from '@/features/chat/ChatArea';
import { useChatStore } from '@/features/chat/chatStore';
import type { Conversation, Message } from '@/features/chat/api';
import { useSettingsStore } from '@/features/settings/settingsStore';
import type { Settings } from '@/features/settings/api';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** jsdom 没有 ResizeObserver：桩实现不回调，气泡保持未测量状态 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
  { id: 2, character_name: '洛茜', last_message: null, created_at: '', updated_at: '' },
];

const SETTINGS: Settings = {
  temperature: 0.8,
  max_tokens: 2048,
  world_setting: '',
  world_setting_is_default: true,
  my_gender: 'male',
  strip_variant: 0,
  typewriter: true,
  model: 'deepseek-flash',
  daily_limit: 100,
  daily_used: 0,
};

/** 一条持久化消息 */
function msg(id: number, side: Message['side'], text: string): Message {
  return { id, side, text, status: 'completed', created_at: '' };
}

/** 选中会话 1 并放入消息 */
function selectConversation(messages: Message[]) {
  useChatStore.setState({
    activeConversationId: 1,
    activeCharacterName: '陈千语',
    messagesByConversation: { 1: messages, 2: [] },
  });
}

/** PATCH 一直不返回的桩（模拟延迟 ≥ 点击间隔），记录每次请求体 */
function pendingPatch() {
  const bodies: unknown[] = [];
  mockFetch(
    (req) =>
      new Promise<Response>(() => {
        bodies.push(req.body);
      }),
  );
  return bodies;
}

describe('ChatArea', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    useChatStore.setState({
      conversations: CONVERSATIONS,
      activeConversationId: null,
      activeCharacterName: null,
      messagesByConversation: {},
      streaming: null,
    });
    useSettingsStore.setState({ settings: SETTINGS });
  });

  /** 未选中会话：提示文案，没有输入框 */
  it('空态显示"- 请选择会话 -"', () => {
    render(<ChatArea />);
    expect(screen.getByText('请选择会话')).toBeInTheDocument();
    expect(screen.getAllByText('-')).toHaveLength(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  /** 选中后：角色名、消息文本、表情图片；我方两条连续消息只有一个头像 */
  it('选中会话后显示角色名与消息', () => {
    selectConversation([
      msg(1, 'mine', '在吗'),
      msg(2, 'mine', '还在吗'),
      msg(3, 'other', '在的[sns_emoji_001]'),
    ]);
    const { container } = render(<ChatArea />);
    expect(screen.getByText('陈千语')).toBeInTheDocument();
    expect(screen.getByText('在吗')).toBeInTheDocument();
    expect(screen.getByText('在的')).toBeInTheDocument();
    expect(container.querySelector('img[src*="sns_emoji_001"]')).not.toBeNull();
    // 头像只出现在第 1 条（我方）与第 3 条（AI）上
    expect(screen.getAllByRole('button', { name: '切换我方头像' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '发消息输入框' })).toBeInTheDocument();
  });

  /** 点击聊天条：v1 → v2，PATCH strip_variant */
  it('点击聊天条循环样式并保存', async () => {
    selectConversation([]);
    const fetchMock = mockFetch((req) => {
      expect(req.method).toBe('PATCH');
      expect(req.path).toBe('/api/settings');
      expect(req.body).toEqual({ strip_variant: 1 });
      return jsonResponse({ ...SETTINGS, strip_variant: 1 });
    });
    render(<ChatArea />);
    const strip = screen.getByRole('button', { name: '切换聊天条样式' });
    expect(strip.getAttribute('src')).toContain('chat_strip_v1');
    await userEvent.click(strip);
    expect(fetchMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(strip.getAttribute('src')).toContain('chat_strip_v2'));
  });

  /** 点击我方头像：male → female，PATCH my_gender，头像图片切换 */
  it('点击我方头像切换性别并保存', async () => {
    selectConversation([msg(1, 'mine', '在吗')]);
    mockFetch((req) => {
      expect(req.body).toEqual({ my_gender: 'female' });
      return jsonResponse({ ...SETTINGS, my_gender: 'female' });
    });
    render(<ChatArea />);
    const avatar = screen.getByRole('button', { name: '切换我方头像' });
    /** 三层里的第二张是肖像 */
    const portrait = () =>
      decodeURIComponent(avatar.querySelectorAll('img')[1].getAttribute('src')!);
    expect(portrait()).toContain('管理员_男');
    await userEvent.click(avatar);
    await waitFor(() => expect(portrait()).toContain('管理员_女'));
  });

  /** PATCH 未返回时连点聊天条两次：第二次基于第一次的乐观值，请求体依次为 1、2，界面已是 v3 */
  it('PATCH 未返回时连点聊天条两次分别发 1、2', async () => {
    selectConversation([]);
    const bodies = pendingPatch();
    render(<ChatArea />);
    const strip = screen.getByRole('button', { name: '切换聊天条样式' });
    await userEvent.click(strip);
    await userEvent.click(strip);
    expect(bodies).toEqual([{ strip_variant: 1 }, { strip_variant: 2 }]);
    expect(strip.getAttribute('src')).toContain('chat_strip_v3');
  });

  /** PATCH 未返回时连点我方头像两次：female、male，头像回到男 */
  it('PATCH 未返回时连点我方头像两次分别发 female、male', async () => {
    selectConversation([msg(1, 'mine', '在吗')]);
    const bodies = pendingPatch();
    render(<ChatArea />);
    const avatar = screen.getByRole('button', { name: '切换我方头像' });
    await userEvent.click(avatar);
    await userEvent.click(avatar);
    expect(bodies).toEqual([{ my_gender: 'female' }, { my_gender: 'male' }]);
    expect(decodeURIComponent(avatar.querySelectorAll('img')[1].getAttribute('src')!)).toContain(
      '管理员_男',
    );
  });

  /** 流式期间：当前会话显示已完成的行与加载气泡；切到其他会话后两者都不显示，但停止按钮仍在 */
  it('流式气泡与加载气泡只在流所属会话显示', () => {
    selectConversation([msg(1, 'mine', '在吗')]);
    useChatStore.setState({
      streaming: {
        conversationId: 1,
        bubbles: ['第一行'],
        typing: false,
        pending: true,
        controller: new AbortController(),
      },
    });
    render(<ChatArea />);
    expect(screen.getByText('第一行')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在回复' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

    act(() => useChatStore.setState({ activeConversationId: 2, activeCharacterName: '洛茜' }));
    expect(screen.getByText('洛茜')).toBeInTheDocument();
    expect(screen.queryByText('第一行')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
  });

  /** 失败消息按普通对方气泡显示其文本 */
  it('failed 消息显示为普通气泡', () => {
    selectConversation([
      msg(1, 'mine', '在吗'),
      { id: 2, side: 'other', text: '[错误: 上游响应超时]', status: 'failed', created_at: '' },
    ]);
    render(<ChatArea />);
    expect(screen.getByText('[错误: 上游响应超时]')).toBeInTheDocument();
  });

  /** 回到底部按钮：暂停跟随后出现"回到底部"，流式新行到达变为"有新消息"，点击平滑滚到底部；我方发送时直接回到底部 */
  it('向上浏览时显示回到底部按钮，新行到达后提示有新消息', () => {
    selectConversation([msg(1, 'mine', '在吗'), msg(2, 'other', '在的')]);
    const controller = new AbortController();
    useChatStore.setState({
      streaming: { conversationId: 1, bubbles: [], typing: false, pending: true, controller },
    });
    const { container } = render(<ChatArea />);
    const scroll = container.querySelector<HTMLDivElement>('.scroll-mask')!;
    // jsdom 没有布局：给滚动容器一个 2000 高的内容、800 高的视口
    const geometry = { top: 1200 };
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, get: () => 2000 },
      clientHeight: { configurable: true, get: () => 800 },
      scrollTop: {
        configurable: true,
        get: () => geometry.top,
        set: (value: number) => {
          geometry.top = Math.max(0, Math.min(value, 1200));
        },
      },
    });
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;

    // 几何是挂载后才定义的：先在底部触发一次 scroll，让 Hook 记下当前位置（真实浏览器挂载时就在底部）
    fireEvent.scroll(scroll);
    // 用户向上滚动 900：出现"回到底部"
    geometry.top = 300;
    fireEvent.scroll(scroll);
    expect(screen.getByRole('button', { name: /回到底部/ })).toBeInTheDocument();

    // 暂停期间流式新行到达：改为"有新消息"，滚动位置不变
    act(() => {
      useChatStore.setState({
        streaming: {
          conversationId: 1,
          bubbles: ['第一行'],
          typing: false,
          pending: true,
          controller,
        },
      });
    });
    expect(screen.getByRole('button', { name: /有新消息/ })).toBeInTheDocument();
    expect(geometry.top).toBe(300);

    // 点击：平滑滚到底部，按钮消失
    fireEvent.click(screen.getByRole('button', { name: /有新消息/ }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: /有新消息|回到底部/ })).not.toBeInTheDocument();

    // scrollTo 是桩：手动模拟平滑滚动结束在底部
    geometry.top = 1200;
    fireEvent.scroll(scroll);

    // 再次向上浏览后我方发送（末尾出现乐观消息）：立即回到底部，按钮消失
    geometry.top = 300;
    fireEvent.scroll(scroll);
    expect(screen.getByRole('button', { name: /回到底部|有新消息/ })).toBeInTheDocument();
    act(() => {
      useChatStore.setState({
        streaming: null,
        messagesByConversation: {
          1: [msg(1, 'mine', '在吗'), msg(2, 'other', '在的'), msg(-1, 'mine', '还在吗')],
          2: [],
        },
      });
    });
    expect(geometry.top).toBe(1200);
    expect(screen.queryByRole('button', { name: /有新消息|回到底部/ })).not.toBeInTheDocument();
  });
});
