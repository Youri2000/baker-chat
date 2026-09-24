/**
 * @file 对话管理对话框测试：未选中会话只显示提示；该角色只剩一个会话时删除按钮禁用并带 title；
 * 删除 / 清空消息 / 清空上下文经确认页后调用对应接口，取消回到主菜单。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { DeleteConfirmDialog } from '@/features/settings/DeleteConfirmDialog';
import { tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch, noContent } from '@/test/mockFetch';

/** 陈千语的两个会话 + 洛茜的一个会话 */
const CONVERSATIONS: Conversation[] = [
  { id: 1, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
  { id: 2, character_name: '陈千语', last_message: null, created_at: '', updated_at: '' },
  { id: 3, character_name: '洛茜', last_message: null, created_at: '', updated_at: '' },
];

describe('DeleteConfirmDialog', () => {
  beforeEach(() => {
    tokenStorage.set('jwt');
    useChatStore.setState({
      conversations: CONVERSATIONS,
      messagesByConversation: { 1: [], 2: [], 3: [] },
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
      streaming: null,
    });
  });

  /** 没有选中会话：只有提示文案，没有操作按钮 */
  it('未选中会话时只显示提示文案', () => {
    render(<DeleteConfirmDialog open onClose={vi.fn()} />);
    expect(screen.getByText('请先在左侧选中一段对话，再进行操作。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除对话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清空消息' })).not.toBeInTheDocument();
  });

  /** 洛茜只有一个会话：删除按钮禁用并用 title 说明 */
  it('该角色只剩一个会话时删除对话按钮禁用', () => {
    useChatStore.setState({ activeConversationId: 3, activeCharacterName: '洛茜' });
    render(<DeleteConfirmDialog open onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: '删除对话' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '该角色只剩这一个会话，无法删除');
    expect(screen.getByRole('button', { name: '清空消息' })).toBeEnabled();
  });

  /** 陈千语有两个会话：删除当前会话 → 确认 → DELETE，关闭对话框并改选相邻会话 */
  it('删除对话经确认后调用接口并改选相邻会话', async () => {
    useChatStore.setState({ activeConversationId: 1, activeCharacterName: '陈千语' });
    const onClose = vi.fn();
    const fetchMock = mockFetch((req) => {
      if (req.method === 'DELETE' && req.path === '/api/conversations/1') return noContent();
      return jsonResponse({ detail: 'not found' }, 404);
    });
    render(<DeleteConfirmDialog open onClose={onClose} />);
    const button = screen.getByRole('button', { name: '删除对话' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getByText('确认删除这个会话？')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual([2, 3]);
  });

  /** 清空消息 → 确认 → POST messages/clear */
  it('清空消息经确认后调用接口', async () => {
    useChatStore.setState({ activeConversationId: 3, activeCharacterName: '洛茜' });
    const onClose = vi.fn();
    const fetchMock = mockFetch((req) => {
      expect(req.method).toBe('POST');
      expect(req.path).toBe('/api/conversations/3/messages/clear');
      return noContent();
    });
    render(<DeleteConfirmDialog open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '清空消息' }));
    expect(screen.getByText('确认清空当前对话的消息？(AI 记忆保留)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** 清空上下文 → 确认 → POST context/clear；取消则回到主菜单不发请求 */
  it('清空上下文可取消，确认后调用接口', async () => {
    useChatStore.setState({ activeConversationId: 3, activeCharacterName: '洛茜' });
    const fetchMock = mockFetch((req) => {
      expect(req.path).toBe('/api/conversations/3/context/clear');
      return noContent();
    });
    render(<DeleteConfirmDialog open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '清空上下文' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '清空上下文' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '清空上下文' }));
    await userEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
