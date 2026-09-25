/**
 * @file settingsStore 测试：updateSettings 的乐观更新（PATCH 返回前本地已变、失败回滚并 toast、
 * 连续两次更新时旧响应不覆盖新值）、reset 回到初始值、删除全部对话后重置并重拉 chatStore。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@/components/toastStore';
import { useChatStore } from '@/features/chat/chatStore';
import type { Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { tokenStorage } from '@/lib/http';
import { flush, jsonResponse, mockFetch, noContent } from '@/test/mockFetch';

const SETTINGS: Settings = {
  temperature: 0.8,
  max_tokens: 2048,
  world_setting: '默认世界观',
  world_setting_is_default: true,
  my_gender: 'male',
  strip_variant: 0,
  model: 'deepseek-flash',
  daily_limit: 100,
  daily_used: 0,
};

/** 可手动放行的 PATCH 桩：每次请求的 body 与放行函数按顺序记录 */
function deferredPatch() {
  const bodies: unknown[] = [];
  const release: Array<(settings: Settings) => void> = [];
  mockFetch(
    (req) =>
      new Promise<Response>((resolve) => {
        bodies.push(req.body);
        release.push((settings) => resolve(jsonResponse(settings)));
      }),
  );
  return { bodies, release };
}

describe('settingsStore.updateSettings', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useSettingsStore.setState({ settings: SETTINGS, prompts: [], stats: null });
    useToastStore.setState({ toasts: [] });
  });

  /** PATCH 还没返回，本地 settings 已经是新值；返回后用响应替换 */
  it('PATCH 返回前本地已更新，返回后用响应替换', async () => {
    const { bodies, release } = deferredPatch();
    const updating = useSettingsStore.getState().updateSettings({ strip_variant: 1 });
    expect(useSettingsStore.getState().settings?.strip_variant).toBe(1);
    expect(bodies).toEqual([{ strip_variant: 1 }]);
    release[0]({ ...SETTINGS, strip_variant: 1, daily_used: 3 });
    await updating;
    expect(useSettingsStore.getState().settings).toEqual({
      ...SETTINGS,
      strip_variant: 1,
      daily_used: 3,
    });
  });

  /** 失败：回到修改前的值并 toast 后端原因 */
  it('PATCH 失败时回滚并 toast', async () => {
    mockFetch(() => jsonResponse({ detail: '参数错误' }, 422));
    await useSettingsStore.getState().updateSettings({ my_gender: 'female' });
    expect(useSettingsStore.getState().settings).toEqual(SETTINGS);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['参数错误']);
  });

  /** 连续两次更新：第二次基于第一次的乐观值；第一次的响应晚到也不会把本地值改回去 */
  it('连续两次更新时旧响应不覆盖新值', async () => {
    const { bodies, release } = deferredPatch();
    const first = useSettingsStore.getState().updateSettings({ strip_variant: 1 });
    const second = useSettingsStore.getState().updateSettings({ strip_variant: 2 });
    expect(bodies).toEqual([{ strip_variant: 1 }, { strip_variant: 2 }]);
    expect(useSettingsStore.getState().settings?.strip_variant).toBe(2);
    release[0]({ ...SETTINGS, strip_variant: 1 });
    await first;
    expect(useSettingsStore.getState().settings?.strip_variant).toBe(2);
    release[1]({ ...SETTINGS, strip_variant: 2 });
    await second;
    expect(useSettingsStore.getState().settings?.strip_variant).toBe(2);
  });

  /** 设置尚未加载（null）时不凭空造 settings，等 PATCH 响应 */
  it('settings 未加载时以 PATCH 响应为准', async () => {
    useSettingsStore.setState({ settings: null });
    mockFetch(() => jsonResponse({ ...SETTINGS, strip_variant: 1 }));
    const updating = useSettingsStore.getState().updateSettings({ strip_variant: 1 });
    expect(useSettingsStore.getState().settings).toBeNull();
    await updating;
    expect(useSettingsStore.getState().settings?.strip_variant).toBe(1);
  });
});

describe('settingsStore.reset / deleteAllConversations', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useChatStore.getState().reset();
  });

  /** reset：三个字段回到初始值 */
  it('reset 回到初始状态', () => {
    useSettingsStore.setState({
      settings: SETTINGS,
      prompts: [{ character_name: '陈千语', prompt: 'x', is_custom: true }],
      stats: { characters: 29, conversations_with_content: 1, messages: 1 },
    });
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState()).toMatchObject({ settings: null, prompts: [], stats: null });
  });

  /** 删除全部对话：chatStore 先 reset 再重拉会话，统计同时刷新 */
  it('deleteAllConversations 后 chatStore 重置并重拉', async () => {
    useChatStore.setState({
      conversations: [
        { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
      ],
      activeConversationId: 1,
      activeCharacterName: '陈千语',
      messagesByConversation: { 1: [] },
    });
    const fresh = [
      { id: 2, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
    ];
    mockFetch((req) => {
      if (req.path === '/api/data/delete-all-conversations') return noContent();
      if (req.path === '/api/conversations') return jsonResponse(fresh);
      return jsonResponse({ characters: 29, conversations_with_content: 0, messages: 0 });
    });
    await useSettingsStore.getState().deleteAllConversations();
    await flush();
    expect(useChatStore.getState()).toMatchObject({
      conversations: fresh,
      activeConversationId: null,
      activeCharacterName: null,
      messagesByConversation: {},
    });
    expect(useSettingsStore.getState().stats).toEqual({
      characters: 29,
      conversations_with_content: 0,
      messages: 0,
    });
  });
});
