/**
 * @file 测试用 fetch 桩：按 method + pathname 路由到处理器，提供 JSON / 204 / 可手动推送的 SSE 响应。
 */
import { vi, type Mock } from 'vitest';

/** 处理器看到的请求 */
export interface MockRequest {
  method: string;
  /** URL 的 pathname，如 '/api/auth/login' */
  path: string;
  /** 解析后的 JSON body；无 body 为 undefined */
  body: unknown;
  headers: Headers;
  signal: AbortSignal | null;
}

/** 请求处理器 */
export type FetchHandler = (req: MockRequest) => Response | Promise<Response>;

/** 把 fetch 替换为路由到 handler 的桩；afterEach 会自动还原 */
export function mockFetch(handler: FetchHandler): Mock {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    return handler({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** JSON 响应 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 204 No Content */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** 可手动推送数据的 SSE 响应 */
export interface SseHandle {
  response: Response;
  /** 推送一段文本（会按 UTF-8 编码） */
  push: (text: string) => void;
  /** 推送原始字节（用于把多字节字符切开） */
  pushBytes: (bytes: Uint8Array) => void;
  close: () => void;
}

/** 构造 text/event-stream 响应；数据由测试逐块推送 */
export function sseResponse(): SseHandle {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    pushBytes: (bytes) => controller.enqueue(bytes),
    close: () => controller.close(),
  };
}

/** 让微任务队列跑空，等待流式回调落地 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
