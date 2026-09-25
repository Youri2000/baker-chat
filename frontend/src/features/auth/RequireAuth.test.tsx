/**
 * @file 路由守卫测试：未登录访问 / 跳 /login；退出登录后回 /login；接口 401 时自动登出并提示，
 * 另一标签页已退出（localStorage 没有 token）时本页的 401 同样回到 /login。
 */
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '@/App';
import { Toast } from '@/components/Toast';
import { useToastStore } from '@/components/toastStore';
import { useAuthStore } from '@/features/auth/authStore';
import { http, tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 从 / 进入完整路由表 */
function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppRoutes />
      <Toast />
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    useToastStore.setState({ toasts: [] });
  });

  /** 没有 token 时看到登录页 */
  it('未登录访问 / 时重定向到 /login', () => {
    mockFetch(() => jsonResponse([]));
    renderApp();
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  /** 有 token 时渲染主页，退出后回登录页 */
  it('已登录时渲染主页，退出登录后回到 /login', async () => {
    tokenStorage.set('jwt');
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    mockFetch(() => jsonResponse([]));
    renderApp();
    expect(screen.getByText('//BAKER/会话消息')).toBeInTheDocument();
    act(() => useAuthStore.getState().logout());
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(tokenStorage.get()).toBeNull();
  });

  /** 任意接口 401：token 清除、跳 /login、提示登录已过期 */
  it('接口返回 401 时自动登出并提示', async () => {
    tokenStorage.set('expired');
    useAuthStore.setState({ token: 'expired', user: { id: 1, username: 'demo' } });
    mockFetch(() => jsonResponse({ detail: '未登录或登录已过期' }, 401));
    renderApp();
    await act(async () => {
      await http('/conversations').catch(() => undefined);
    });
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByText('登录已过期，请重新登录')).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });

  /** 另一标签页已退出：localStorage 没有 token，本页内存里还有；不带 token 的请求 401 后同样登出并提示 */
  it('另一标签页退出后本页的 401 也回到 /login', async () => {
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    mockFetch((req) => {
      expect(req.headers.has('Authorization')).toBe(false);
      return jsonResponse({ detail: '未登录或登录已过期' }, 401);
    });
    renderApp();
    expect(screen.getByText('//BAKER/会话消息')).toBeInTheDocument();
    await act(async () => {
      await http('/conversations/1/messages').catch(() => undefined);
    });
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByText('登录已过期，请重新登录')).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });
});
