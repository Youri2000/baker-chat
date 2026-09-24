/**
 * @file 鉴权接口（docs/api.md §1）：注册、登录、当前用户。
 */
import { http } from '@/lib/http';

/** 当前用户 */
export interface User {
  id: number;
  username: string;
}

/** 注册 / 登录成功响应 */
export interface AuthResponse {
  token: string;
  user: User;
}

/** 注册：409 用户名已被占用 */
export function register(username: string, password: string): Promise<AuthResponse> {
  return http<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } });
}

/** 登录：401 用户名或密码错误 */
export function login(username: string, password: string): Promise<AuthResponse> {
  return http<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } });
}

/** 用 token 取当前用户 */
export function me(): Promise<User> {
  return http<User>('/auth/me');
}
