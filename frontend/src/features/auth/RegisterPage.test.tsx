/**
 * @file 注册页测试：用户名规则、密码长度、两次密码不一致、后端 409、注册成功跳 /。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { useAuthStore } from '@/features/auth/authStore';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 在 /register 渲染注册页，/ 渲染占位主页 */
function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 填三个字段并提交 */
async function submit(username: string, password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('用户名'), username);
  await userEvent.type(screen.getByLabelText('密码'), password);
  await userEvent.type(screen.getByLabelText('确认密码'), confirm);
  await userEvent.click(screen.getByRole('button', { name: '注册' }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  /** 含非法字符 / 过短的用户名与过短密码都在本地拦下 */
  it('用户名不合规或密码过短时提示且不发请求', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    renderRegister();
    await submit('a-b', '123', '123');
    expect(screen.getByText('用户名为 3–20 位字母、数字或下划线')).toBeInTheDocument();
    expect(screen.getByText('密码为 6–64 位')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** 两次密码不一致 */
  it('两次密码不一致时在确认密码下方提示', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    renderRegister();
    await submit('newuser', 'secret1', 'secret2');
    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** 后端 409 的 detail 显示在用户名下方 */
  it('用户名被占用时显示后端 409 原因', async () => {
    mockFetch(() => jsonResponse({ detail: '用户名已被占用' }, 409));
    renderRegister();
    await submit('demo', 'secret1', 'secret1');
    expect(await screen.findByText('用户名已被占用')).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  /** 注册成功即登录并跳 / */
  it('注册成功后进入已登录状态并跳转到 /', async () => {
    mockFetch((req) => {
      expect(req.path).toBe('/api/auth/register');
      return jsonResponse({ token: 'jwt', user: { id: 2, username: 'newuser' } }, 201);
    });
    renderRegister();
    await submit('newuser', 'secret1', 'secret1');
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('jwt');
  });
});
