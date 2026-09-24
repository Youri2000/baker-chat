/**
 * @file 手写 SSE 解析：fetch + ReadableStream + TextDecoder(stream)，按行缓冲解析后端的
 * `data: {delta|usage|error}` 与 `[DONE]` 帧。每次调用由调用方传入独立的 AbortSignal。
 * 💡 不用 EventSource：它只支持 GET 且不能带 Authorization 头，详见 docs/interview.md#sse
 */
import { assertOk, buildHeaders } from '@/lib/http';

/** 上游 token 用量（最后一帧，可选） */
export interface SseUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/** 流式回调与控制 */
export interface StreamSseOptions {
  signal: AbortSignal;
  token: string | null;
  /** 增量文本 */
  onDelta: (delta: string) => void;
  /** 上游用量统计 */
  onUsage?: (usage: SseUsage) => void;
  /** 后端转发的中文错误原因；随后必定收到 [DONE] */
  onError: (message: string) => void;
  /** 收到 [DONE] */
  onDone: () => void;
}

/**
 * 按 `\n` 切出已完整到达的行：每行去首尾空白、跳过空行；最后一个未以换行结束的片段作为 rest 返回。
 * SSE 帧与 AI 回复文本的按行分段都用它。
 */
export function takeCompletedLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const lines = parts.map((line) => line.trim()).filter((line) => line !== '');
  return { lines, rest };
}

/** 一帧 data 的 JSON 形状（三种字段互斥） */
interface SseFrame {
  delta?: string;
  usage?: SseUsage;
  error?: string;
}

/** 分发一行 `data: …`；返回 true 表示收到 [DONE] */
function dispatchLine(line: string, options: StreamSseOptions): boolean {
  if (!line.startsWith('data:')) return false;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') {
    options.onDone();
    return true;
  }
  const frame = JSON.parse(payload) as SseFrame;
  if (frame.delta !== undefined) options.onDelta(frame.delta);
  if (frame.usage !== undefined) options.onUsage?.(frame.usage);
  if (frame.error !== undefined) options.onError(frame.error);
  return false;
}

/**
 * ✅ POST 一个 JSON body 并消费 SSE 响应，直到 [DONE]、流结束或被 abort。
 * 非 2xx 时抛 ApiError（如 429 今日额度已用完）；abort 后静默返回且不再触发任何回调。
 */
export async function streamSse(
  url: string,
  body: unknown,
  options: StreamSseOptions,
): Promise<void> {
  const { signal } = options;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(options.token),
    body: JSON.stringify(body),
    signal,
  });
  await assertOk(res, options.token !== null);
  // 后端契约保证 text/event-stream 一定有响应体
  const reader = res.body!.getReader();
  // ⚠️ decode(…, {stream: true}) 让被切在两个 chunk 之间的多字节字符留在解码器内部，不会产出乱码
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // ⚠️ abort 之后即使 mock 流仍有数据，也不再回调
      if (signal.aborted) return;
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = takeCompletedLines(buffer);
      buffer = rest;
      for (const line of lines) {
        if (dispatchLine(line, options)) {
          await reader.cancel();
          return;
        }
      }
    }
  } catch (err) {
    // abort 会让 read() 以 AbortError 拒绝，这是正常结束
    if (signal.aborted) return;
    throw err;
  }
}
