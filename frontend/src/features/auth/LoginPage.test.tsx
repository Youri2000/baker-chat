/**
 * @file 登录页测试：空字段校验、密码错误提示、一键填入、登录成功跳转 /、已登录访问 /login 跳 /。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuthStore } from '@/features/auth/authStore';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 在 /login 渲染登录页，/ 渲染占位主页 */
function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  /** 空表单提交只在本地报错，不发请求 */
  it('空字段提交时在输入框下方提示', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByText('请输入用户名')).toBeInTheDocument();
    expect(screen.getByText('请输入密码')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** 后端 401 的 detail 显示在密码框下方，页面不跳转 */
  it('密码错误时显示"用户名或密码错误"并停留', async () => {
    mockFetch(() => jsonResponse({ detail: '用户名或密码错误' }, 401));
    renderLogin();
    await userEvent.type(screen.getByLabelText('用户名'), 'demo');
    await userEvent.type(screen.getByLabelText('密码'), 'wrong1');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  /** 一键填入演示账号后登录成功，token 落库并跳 / */
  it('一键填入并登录成功后跳转到 /', async () => {
    mockFetch((req) => {
      expect(req.body).toEqual({ username: 'demo', password: 'demo123' });
      return jsonResponse({ token: 'jwt', user: { id: 1, username: 'demo' } });
    });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '一键填入' }));
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(localStorage.getItem('baker.token')).toBe('jwt');
    expect(useAuthStore.getState().user).toEqual({ id: 1, username: 'demo' });
  });

  /** 已登录用户访问 /login 直接跳 / */
  it('已登录访问 /login 时跳转到 /', () => {
    useAuthStore.setState({ token: 'jwt', user: { id: 1, username: 'demo' } });
    renderLogin();
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
