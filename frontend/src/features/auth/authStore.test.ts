/**
 * @file authStore 测试：退出登录 / 登录新账号 / 401 都把 chatStore 与 settingsStore 重置为初始值，
 * 上一个用户的会话与设置不会留给下一个用户；退出时中止进行中的 AI 回复流；并发 401 只提示一次。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@/components/toastStore';
import { http, tokenStorage } from '@/lib/http';
import { useAuthStore } from '@/features/auth/authStore';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import type { Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 上一个用户的会话 */
const OLD_CONVERSATION: Conversation = {
  id: 7,
  character_name: '陈千语',
  last_message: { side: 'mine', text: '上一个用户的消息' },
  created_at: '',
  updated_at: '',
};

/** 上一个用户的设置 */
const OLD_SETTINGS: Settings = {
  temperature: 1.5,
  max_tokens: 100,
  world_setting: '上一个用户的世界观',
  world_setting_is_default: false,
  my_gender: 'female',
  strip_variant: 2,
  model: 'deepseek-flash',
  daily_limit: 100,
  daily_used: 9,
};

/** 把两个 store 填成"上一个用户已登录并用过"的样子 */
function fillPreviousUserData() {
  useChatStore.setState({
    conversations: [OLD_CONVERSATION],
    messagesByConversation: { 7: [] },
    activeConversationId: 7,
    activeCharacterName: '陈千语',
    collapsedCharacters: { ...useChatStore.getState().collapsedCharacters, 陈千语: false },
  });
  useSettingsStore.setState({
    settings: OLD_SETTINGS,
    prompts: [{ character_name: '陈千语', prompt: '覆盖', is_custom: true }],
    stats: { characters: 29, conversations_with_content: 1, messages: 2 },
  });
}

/** 两个 store 都回到初始值 */
function expectStoresReset() {
  expect(useChatStore.getState()).toMatchObject({
    conversations: [],
    messagesByConversation: {},
    activeConversationId: null,
    activeCharacterName: null,
    streaming: null,
  });
  expect(useChatStore.getState().collapsedCharacters['陈千语']).toBe(true);
  expect(useSettingsStore.getState()).toMatchObject({ settings: null, prompts: [], stats: null });
}

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    useChatStore.getState().reset();
    useSettingsStore.getState().reset();
    useToastStore.setState({ toasts: [] });
  });

  /** 退出：abort 进行中的流，token、user 与两个 store 全部清掉 */
  it('logout 中止进行中的回复流并重置两个 store', () => {
    const controller = new AbortController();
    tokenStorage.set('jwt');
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    fillPreviousUserData();
    useChatStore.setState({
      streaming: { conversationId: 7, bubbles: ['第一行'], pending: true, controller },
    });

    useAuthStore.getState().logout();

    expect(controller.signal.aborted).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
    expect(tokenStorage.get()).toBeNull();
    expectStoresReset();
  });

  /** 登录新账号：旧 conversations / settings 不残留，token 写入 */
  it('login 成功后不残留上一个用户的数据', async () => {
    fillPreviousUserData();
    mockFetch(() => jsonResponse({ token: 'jwt-b', user: { id: 2, username: 'b' } }));

    await useAuthStore.getState().login('b', 'secret123');

    expect(useAuthStore.getState()).toMatchObject({ token: 'jwt-b', user: { id: 2 } });
    expect(tokenStorage.get()).toBe('jwt-b');
    expectStoresReset();
  });

  /** 注册即登录，同样重置 */
  it('register 成功后不残留上一个用户的数据', async () => {
    fillPreviousUserData();
    mockFetch(() => jsonResponse({ token: 'jwt-c', user: { id: 3, username: 'c' } }, 201));

    await useAuthStore.getState().register('c', 'secret123');

    expect(useAuthStore.getState().token).toBe('jwt-c');
    expectStoresReset();
  });

  /** 登录失败不动现有状态（表单显示原因即可） */
  it('login 失败时抛出且不写 token', async () => {
    mockFetch(() => jsonResponse({ detail: '用户名或密码错误' }, 401));
    await expect(useAuthStore.getState().login('demo', 'wrong1')).rejects.toMatchObject({
      status: 401,
    });
    expect(useAuthStore.getState().token).toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });

  /** 401 处理器：重置两个 store、清登录态、提示；并发的第二个 401 不再提示 */
  it('接口 401 时重置两个 store，并发多个 401 只提示一次', async () => {
    tokenStorage.set('expired');
    useAuthStore.setState({ token: 'expired', user: { id: 1, username: 'demo' } });
    fillPreviousUserData();
    mockFetch(() => jsonResponse({ detail: '未登录或登录已过期' }, 401));

    await Promise.all([
      http('/conversations').catch(() => undefined),
      http('/settings').catch(() => undefined),
    ]);

    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
    expect(tokenStorage.get()).toBeNull();
    expectStoresReset();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      '登录已过期，请重新登录',
    ]);
  });

  /** 退出后残留请求的 401（如流结束后的重拉）：内存里已经没有 token，不再提示 */
  it('已退出后再收到 401 不提示', async () => {
    useAuthStore.setState({ token: null, user: null });
    mockFetch(() => jsonResponse({ detail: '未登录或登录已过期' }, 401));
    await http('/conversations/1/messages').catch(() => undefined);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
