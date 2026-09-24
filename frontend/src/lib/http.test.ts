/**
 * @file fetch 封装测试：地址拼接与 Bearer、JSON 解析、非 2xx → ApiError、401 的登录过期处理。
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError, http, onUnauthorized, tokenStorage } from '@/lib/http';
import { jsonResponse, mockFetch, noContent } from '@/test/mockFetch';

describe('http', () => {
  /** 拼 /api 前缀，带 token 时附加 Authorization */
  it('拼接地址并自动带 Bearer', async () => {
    tokenStorage.set('abc');
    const fetchMock = mockFetch((req) => {
      expect(req.path).toBe('/api/settings');
      expect(req.headers.get('Authorization')).toBe('Bearer abc');
      expect(req.headers.get('Content-Type')).toBe('application/json');
      return jsonResponse({ model: 'm' });
    });
    await expect(http<{ model: string }>('/settings')).resolves.toEqual({ model: 'm' });
    expect(fetchMock).toHaveBeenCalledWith('http://backend.test/api/settings', expect.anything());
  });

  /** 没有 token 就不带 Authorization；body 会被 JSON 序列化 */
  it('未登录时不带 Authorization，body 序列化为 JSON', async () => {
    mockFetch((req) => {
      expect(req.headers.has('Authorization')).toBe(false);
      expect(req.body).toEqual({ username: 'u', password: 'p' });
      return jsonResponse({ token: 't' }, 201);
    });
    await http('/auth/register', { method: 'POST', body: { username: 'u', password: 'p' } });
  });

  /** 204 没有响应体 */
  it('204 返回 undefined', async () => {
    mockFetch(() => noContent());
    await expect(http<void>('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  /** 非 2xx 用后端 detail 抛 ApiError */
  it('非 2xx 抛 ApiError 且带 status 与 detail', async () => {
    mockFetch(() => jsonResponse({ detail: '用户名已被占用' }, 409));
    const err = await http('/auth/register', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, detail: '用户名已被占用' });
  });

  /** 带 token 的 401：清 token，处理器只触发一次 */
  it('带 token 的 401 清除 token 并只触发一次处理器', async () => {
    tokenStorage.set('expired');
    const handler = vi.fn();
    onUnauthorized(handler);
    mockFetch(() => jsonResponse({ detail: '未登录或登录已过期' }, 401));
    await expect(http('/conversations')).rejects.toMatchObject({ status: 401 });
    await expect(http('/settings')).rejects.toMatchObject({ status: 401 });
    expect(tokenStorage.get()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  /** 登录接口密码错误的 401 不是登录过期 */
  it('未带 token 的 401 不触发处理器', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockFetch(() => jsonResponse({ detail: '用户名或密码错误' }, 401));
    await expect(http('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      detail: '用户名或密码错误',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
