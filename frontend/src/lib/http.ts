/**
 * @file fetch 封装：拼接 API 地址、JSON 编解码、自动带 Bearer、非 2xx 抛 ApiError。
 * 同时是 token 的持久化出口（localStorage），401 时清除 token 并通知 authStore 注册的回调；
 * lib 不反向依赖 features，所以用一次性注册而不是直接 import store。
 */

/** 后端 API 根地址（VITE_API_BASE_URL + /api） */
export const API_BASE = `${import.meta.env.VITE_API_BASE_URL}/api`;

const TOKEN_KEY = 'baker.token';

/** 登录 token 的读写；只有这里碰 localStorage */
export const tokenStorage = {
  /** 当前 token，未登录为 null */
  get(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

/** 非 2xx 响应；detail 是后端返回的中文原因 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** 401 处理器；authStore 加载前是空操作 */
let unauthorizedHandler: () => void = () => {};

/** 注册"登录已过期"处理器（authStore 在模块加载时注册一次） */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * 校验响应状态：非 2xx 解析 `{detail}` 抛出 ApiError。
 * ⚠️ 带 token 的请求收到 401 = 登录已过期：清 token 并触发处理器；并发的多个 401 只触发一次。
 * 未带 token 的 401（登录接口密码错误）只是普通错误。
 */
export async function assertOk(res: Response, sentWithToken: boolean): Promise<void> {
  if (res.ok) return;
  if (res.status === 401 && sentWithToken && tokenStorage.get() !== null) {
    tokenStorage.clear();
    unauthorizedHandler();
  }
  throw new ApiError(res.status, await readDetail(res));
}

/** 从错误响应里取 detail；网关等非 JSON 响应回退到状态文本 */
async function readDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      const { detail } = body;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
  } catch {
    // 非 JSON 响应体
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** 构造请求头：JSON + 可选 Bearer */
export function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 请求选项 */
export interface HttpInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * 发送 JSON 请求并解析 JSON 响应；path 以 `/` 开头、不含 `/api`。
 * 204 返回 undefined，调用方用 `http<void>` 标注。
 */
export async function http<T>(path: string, init: HttpInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: buildHeaders(token),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  await assertOk(res, token !== null);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
