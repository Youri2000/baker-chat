/**
 * @file 设置对话框测试：AI 配置的保存 / 恢复默认 / 连接测试两种结果与只读信息；世界观恢复默认；
 * 角色提示词默认选中当前会话角色、徽标显示、保存空值 PUT 后徽标消失；数据管理统计与二次确认；
 * 切换标签保留草稿；关于页退出登录清除 token。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import { useAuthStore } from '@/features/auth/authStore';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import type { CharacterPrompt, Settings, Stats } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch, noContent, type MockRequest } from '@/test/mockFetch';

/** 已加载的设置 */
const SETTINGS: Settings = {
  temperature: 0.8,
  max_tokens: 2048,
  world_setting: '默认世界观',
  world_setting_is_default: true,
  my_gender: 'male',
  strip_variant: 0,
  model: 'deepseek-flash',
  daily_limit: 100,
  daily_used: 3,
};

/** 提示词：陈千语已自定义，其余内置 */
const PROMPTS: CharacterPrompt[] = CHARACTERS.map((c) => ({
  character_name: c.name,
  prompt: c.name === '陈千语' ? '自定义提示词' : `${c.name}的内置提示词`,
  is_custom: c.name === '陈千语',
}));

const STATS: Stats = { characters: 29, conversations_with_content: 3, messages: 12 };

const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
];

/** 默认桩：GET 都返回固定数据，其余 404 */
function defaultHandler(req: MockRequest): Response {
  if (req.path === '/api/settings') return jsonResponse(SETTINGS);
  if (req.path === '/api/prompts') return jsonResponse(PROMPTS);
  if (req.path === '/api/data/stats') return jsonResponse(STATS);
  if (req.path === '/api/conversations') return jsonResponse(CONVERSATIONS);
  return jsonResponse({ detail: 'not found' }, 404);
}

/** 打开对话框并切到某个标签页 */
async function openTab(label: string) {
  render(<SettingsDialog open onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole('tab', { name: label }));
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    useSettingsStore.setState({ settings: SETTINGS, prompts: [], stats: null });
    useChatStore.setState({
      conversations: CONVERSATIONS,
      messagesByConversation: {},
      activeConversationId: 1,
      activeCharacterName: '陈千语',
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
      streaming: null,
    });
  });

  /** 六个标签，默认 AI 配置；显示只读的模型名与剩余额度 */
  it('默认显示 AI 配置：模型名与今日剩余额度', () => {
    mockFetch(defaultHandler);
    render(<SettingsDialog open onClose={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: 'AI 配置' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('deepseek-flash')).toBeInTheDocument();
    expect(screen.getByText('97 / 100')).toBeInTheDocument();
    expect(screen.getByLabelText('温度 (0.8)')).toHaveValue('0.8');
    expect(screen.getByLabelText('最大 Token 数')).toHaveValue(2048);
  });

  /** 拖动滑块、改 Token 后保存 → PATCH 两个字段 */
  it('保存 AI 配置时 PATCH 温度与最大 Token', async () => {
    const fetchMock = mockFetch((req) => {
      if (req.method === 'PATCH' && req.path === '/api/settings') {
        expect(req.body).toEqual({ temperature: 1.2, max_tokens: 4096 });
        return jsonResponse({ ...SETTINGS, temperature: 1.2, max_tokens: 4096 });
      }
      return defaultHandler(req);
    });
    render(<SettingsDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('温度 (0.8)'), { target: { value: '1.2' } });
    expect(screen.getByLabelText('温度 (1.2)')).toBeInTheDocument();
    const tokens = screen.getByLabelText('最大 Token 数');
    await userEvent.clear(tokens);
    await userEvent.type(tokens, '4096');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(useSettingsStore.getState().settings?.temperature).toBe(1.2));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  /** 恢复默认：草稿与后端都回到 0.8 / 2048 */
  it('恢复默认时 PATCH 0.8 / 2048', async () => {
    useSettingsStore.setState({ settings: { ...SETTINGS, temperature: 1.5, max_tokens: 100 } });
    mockFetch((req) => {
      if (req.method === 'PATCH') {
        expect(req.body).toEqual({ temperature: 0.8, max_tokens: 2048 });
        return jsonResponse(SETTINGS);
      }
      return defaultHandler(req);
    });
    render(<SettingsDialog open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('温度 (0.8)')).toBeInTheDocument();
    expect(screen.getByLabelText('最大 Token 数')).toHaveValue(2048);
    await waitFor(() => expect(useSettingsStore.getState().settings?.max_tokens).toBe(2048));
  });

  /** 连接测试成功 */
  it('连接测试成功时显示"连接成功"', async () => {
    mockFetch((req) =>
      req.path === '/api/ai/ping'
        ? jsonResponse({ ok: true, model: 'deepseek-flash' })
        : defaultHandler(req),
    );
    render(<SettingsDialog open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '连接测试' }));
    expect(await screen.findByRole('status')).toHaveTextContent('连接成功');
  });

  /** 连接测试失败：显示后端给的中文原因 */
  it('连接测试失败时显示"连接失败：原因"', async () => {
    mockFetch((req) =>
      req.path === '/api/ai/ping'
        ? jsonResponse({ ok: false, model: 'deepseek-flash', error: '上游认证失败（401）' })
        : defaultHandler(req),
    );
    render(<SettingsDialog open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '连接测试' }));
    expect(await screen.findByRole('status')).toHaveTextContent('连接失败：上游认证失败（401）');
  });

  /** 世界观恢复默认：PATCH 空串，textarea 回填后端返回的默认文本 */
  it('世界观恢复默认时 PATCH 空串并回填默认文本', async () => {
    const custom: Settings = {
      ...SETTINGS,
      world_setting: '我的世界观',
      world_setting_is_default: false,
    };
    useSettingsStore.setState({ settings: custom });
    // AI 配置页先挂载并重拉一次设置，GET 也要返回自定义值
    mockFetch((req) => {
      if (req.method === 'PATCH') {
        expect(req.body).toEqual({ world_setting: '' });
        return jsonResponse(SETTINGS);
      }
      if (req.path === '/api/settings') return jsonResponse(custom);
      return defaultHandler(req);
    });
    await openTab('世界观设定');
    expect(screen.getByLabelText('世界观设定')).toHaveValue('我的世界观');
    await userEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(screen.getByLabelText('世界观设定')).toHaveValue('默认世界观'));
  });

  /** 角色提示词：默认选中当前会话角色，显示徽标；清空后保存 → PUT 空串 → 徽标消失 */
  it('角色提示词保存空值时 PUT 并让徽标消失', async () => {
    const fetchMock = mockFetch((req) => {
      if (req.method === 'PUT') {
        expect(decodeURIComponent(req.path)).toBe('/api/prompts/陈千语');
        expect(req.body).toEqual({ prompt: '' });
        return jsonResponse({ character_name: '陈千语', prompt: '内置提示词', is_custom: false });
      }
      return defaultHandler(req);
    });
    await openTab('角色提示词');
    expect(screen.getByLabelText('角色')).toHaveValue('陈千语');
    expect(await screen.findByText('已自定义')).toBeInTheDocument();
    const textarea = screen.getByLabelText('角色提示词');
    expect(textarea).toHaveValue('自定义提示词');
    await userEvent.clear(textarea);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByText('已自定义')).not.toBeInTheDocument());
    expect(textarea).toHaveValue('内置提示词');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });

  /** 换角色后草稿切到该角色的生效文本；没有选中会话时下拉停在"选择角色…"且不能编辑 */
  it('切换角色显示对应提示词；未选中会话时不可编辑', async () => {
    mockFetch(defaultHandler);
    await openTab('角色提示词');
    await userEvent.selectOptions(screen.getByLabelText('角色'), '洛茜');
    await waitFor(() =>
      expect(screen.getByLabelText('角色提示词')).toHaveValue('洛茜的内置提示词'),
    );
    expect(screen.queryByText('已自定义')).not.toBeInTheDocument();
  });

  /** 未选中会话：下拉为空、textarea 与按钮禁用 */
  it('未选中会话时角色提示词不可编辑', async () => {
    useChatStore.setState({ activeConversationId: null, activeCharacterName: null });
    mockFetch(defaultHandler);
    await openTab('角色提示词');
    expect(screen.getByLabelText('角色')).toHaveValue('');
    expect(screen.getByLabelText('角色提示词')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  /** 数据管理：统计行；删除全部对话二次确认后 POST 并刷新统计 */
  it('数据管理显示统计并在确认后删除全部对话', async () => {
    let stats = STATS;
    const fetchMock = mockFetch((req) => {
      if (req.path === '/api/data/delete-all-conversations') {
        stats = { characters: 29, conversations_with_content: 0, messages: 0 };
        return noContent();
      }
      if (req.path === '/api/data/stats') return jsonResponse(stats);
      return defaultHandler(req);
    });
    await openTab('数据管理');
    expect(await screen.findByText('干员 29 · 对话 3 · 消息 12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '删除全部对话' }));
    expect(screen.getByText('将删除全部对话，确定吗？')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '删除全部对话' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '删除全部对话' }));
    await userEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByText('干员 29 · 对话 0 · 消息 0')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/delete-all-conversations')),
    ).toHaveLength(1);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  /** 六个标签页同时挂载：切走再切回，未保存的草稿仍在 */
  it('切换标签后回来草稿保留', async () => {
    mockFetch(defaultHandler);
    await openTab('世界观设定');
    const textarea = screen.getByLabelText('世界观设定');
    await userEvent.type(textarea, '，补充一句');
    await userEvent.click(screen.getByRole('tab', { name: '关于' }));
    expect(textarea).not.toBeVisible();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: '世界观设定' }));
    expect(textarea).toBeVisible();
    expect(textarea).toHaveValue('默认世界观，补充一句');
  });

  /** 关于：退出登录清除 token */
  it('关于页退出登录清除 token', async () => {
    mockFetch(defaultHandler);
    await openTab('关于');
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/Youri2000/baker-chat',
    );
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(useAuthStore.getState().token).toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });
});
