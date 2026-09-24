/**
 * @file authStore 测试：退出登录清掉登录态，并中止进行中的 AI 回复流。
 */
import { describe, expect, it } from 'vitest';
import { tokenStorage } from '@/lib/http';
import { useAuthStore } from '@/features/auth/authStore';
import { useChatStore } from '@/features/chat/chatStore';

describe('authStore.logout', () => {
  /** 退出时 abort 进行中的流、清空 streaming，token 与 user 同时清掉 */
  it('中止进行中的回复流并清空登录态', () => {
    const controller = new AbortController();
    tokenStorage.set('jwt');
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    useChatStore.setState({
      streaming: { conversationId: 1, bubbles: ['第一行'], pending: true, controller },
    });

    useAuthStore.getState().logout();

    expect(controller.signal.aborted).toBe(true);
    expect(useChatStore.getState().streaming).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
    expect(tokenStorage.get()).toBeNull();
  });

  /** 没有回复在进行时退出同样正常 */
  it('没有进行中的流时只清登录态', () => {
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    useChatStore.setState({ streaming: null });

    useAuthStore.getState().logout();

    expect(useChatStore.getState().streaming).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });
});
