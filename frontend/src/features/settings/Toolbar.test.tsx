/**
 * @file 工具栏测试：E 键切换显隐（输入框内 / 带修饰键不触发）、未选主卡点新建弹提示、
 * 已选主卡点新建创建会话并选中、对话管理与设置按钮打开对应对话框。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { Toolbar } from '@/features/settings/Toolbar';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 陈千语的一个会话 */
const CONVERSATION: Conversation = {
  id: 1,
  character_name: '陈千语',
  last_message: null,
  created_at: '',
  updated_at: '',
};

/** 三个工具栏按钮 */
function toolbarButtons(): HTMLElement[] {
  return ['新建会话', '对话管理', '设置']
    .map((name) => screen.queryByRole('button', { name }))
    .filter((el): el is HTMLElement => el !== null);
}

describe('Toolbar', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useChatStore.setState({
      conversations: [CONVERSATION],
      messagesByConversation: {},
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
      streaming: null,
    });
    useSettingsStore.setState({ settings: null, prompts: [], stats: null });
  });

  /** 焦点不在输入框时按 E：隐藏，再按恢复 */
  it('E 键切换工具栏显隐', () => {
    render(<Toolbar />);
    expect(toolbarButtons()).toHaveLength(3);
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(toolbarButtons()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'E' });
    expect(toolbarButtons()).toHaveLength(3);
  });

  /** 焦点在 input / textarea 内，或带 Ctrl / Meta / Alt 时不切换 */
  it('输入框内或带修饰键按 E 不触发', () => {
    render(
      <>
        <input aria-label="field" />
        <textarea aria-label="area" />
        <Toolbar />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'e' });
    fireEvent.keyDown(screen.getByLabelText('area'), { key: 'e' });
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'e', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'e', altKey: true });
    expect(toolbarButtons()).toHaveLength(3);
  });

  /** 没有选中主卡：弹"请先选中角色卡片"，只有"确定"，不发请求 */
  it('未选中主卡点新建会话时弹出提示框', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    render(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: '新建会话' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('请先选中角色卡片')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确定' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** 已选中主卡：POST 创建会话并选中新会话 */
  it('已选中主卡点新建会话时创建并选中新会话', async () => {
    useChatStore.setState({ activeCharacterName: '陈千语' });
    const created: Conversation = { ...CONVERSATION, id: 9 };
    const fetchMock = mockFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/api/conversations');
      expect(req.body).toEqual({ character_name: '陈千语' });
      return jsonResponse(created, 201);
    });
    render(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBe(9));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual([1, 9]);
    expect(useChatStore.getState().collapsedCharacters['陈千语']).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /** 对话管理 / 设置按钮打开对应对话框，× 关闭 */
  it('对话管理与设置按钮打开对应对话框', async () => {
    mockFetch(() => jsonResponse({ detail: 'not found' }, 404));
    render(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: '对话管理' }));
    expect(screen.getByRole('dialog', { name: '对话管理' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });
});
