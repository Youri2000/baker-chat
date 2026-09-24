/**
 * @file SSE 解析测试：行缓冲跨块、多字节字符被切开、单块多帧、错误帧、[DONE]、abort 后不再回调、非 2xx。
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { streamSse, takeCompletedLines, type StreamSseOptions } from '@/lib/sse';
import { flush, jsonResponse, mockFetch, sseResponse, type SseHandle } from '@/test/mockFetch';

describe('takeCompletedLines', () => {
  /** 只有以换行结束的部分算完整行 */
  it('切出完整行并保留未完成的尾部', () => {
    expect(takeCompletedLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
  });

  /** 行首尾空白去掉，空行跳过 */
  it('去首尾空白并跳过空行', () => {
    expect(takeCompletedLines('  第一行 \n\n \n第二行\r\n')).toEqual({
      lines: ['第一行', '第二行'],
      rest: '',
    });
  });

  /** 没有换行时全部是 rest */
  it('没有换行时全部作为 rest', () => {
    expect(takeCompletedLines('半行')).toEqual({ lines: [], rest: '半行' });
  });
});

/** 启动一次流式请求，返回回调 spy 与推送句柄 */
function startStream(signal = new AbortController().signal): {
  sse: SseHandle;
  options: StreamSseOptions;
  done: Promise<void>;
} {
  const sse = sseResponse();
  mockFetch(() => sse.response);
  const options: StreamSseOptions = {
    signal,
    token: 't',
    onDelta: vi.fn(),
    onUsage: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  };
  const done = streamSse('http://backend.test/api/conversations/1/chat', { text: 'hi' }, options);
  return { sse, options, done };
}

describe('streamSse', () => {
  /** 一行被切在两个 chunk 里，只有拼完整后才解析 */
  it('一行跨两个 chunk 时等到换行才回调', async () => {
    const { sse, options, done } = startStream();
    sse.push('data: {"delta":"第一');
    await flush();
    expect(options.onDelta).not.toHaveBeenCalled();
    sse.push('行"}\n\n');
    await flush();
    expect(options.onDelta).toHaveBeenCalledWith('第一行');
    sse.close();
    await done;
  });

  /** "行" 的三个 UTF-8 字节被切在两个 chunk 之间 */
  it('中文多字节字符被切在两个 chunk 之间时不产生乱码', async () => {
    const { sse, options, done } = startStream();
    const bytes = new TextEncoder().encode('data: {"delta":"第一行"}\n');
    // 在最后一个汉字（3 字节）中间切开
    const cut = bytes.length - 5; // …行"}\n → 切在 "行" 的第 2 个字节后
    sse.pushBytes(bytes.slice(0, cut));
    await flush();
    sse.pushBytes(bytes.slice(cut));
    await flush();
    expect(options.onDelta).toHaveBeenCalledWith('第一行');
    sse.close();
    await done;
  });

  /** 一个 chunk 里有多帧，按顺序全部分发 */
  it('一个 chunk 含多帧时逐帧回调', async () => {
    const { sse, options, done } = startStream();
    sse.push(
      'data: {"delta":"A"}\n\ndata: {"delta":"B"}\n\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
    );
    await flush();
    expect(vi.mocked(options.onDelta).mock.calls).toEqual([['A'], ['B']]);
    expect(options.onUsage).toHaveBeenCalledWith({ prompt_tokens: 1, completion_tokens: 2 });
    sse.close();
    await done;
  });

  /** 错误帧走 onError，随后的 [DONE] 正常结束 */
  it('error 帧回调 onError', async () => {
    const { sse, options, done } = startStream();
    sse.push('data: {"error":"上游限流，请稍后再试"}\n\ndata: [DONE]\n\n');
    await done;
    expect(options.onError).toHaveBeenCalledWith('上游限流，请稍后再试');
    expect(options.onDone).toHaveBeenCalledTimes(1);
  });

  /** [DONE] 之后立即结束，后面的数据不再读 */
  it('[DONE] 后 resolve 且不再处理后续数据', async () => {
    const { sse, options, done } = startStream();
    sse.push('data: {"delta":"A"}\n\ndata: [DONE]\n\ndata: {"delta":"B"}\n\n');
    await done;
    expect(options.onDone).toHaveBeenCalledTimes(1);
    expect(options.onDelta).toHaveBeenCalledTimes(1);
  });

  /** abort 之后即使流还在推数据也不再回调，promise 正常 resolve */
  it('abort 后不再回调', async () => {
    const controller = new AbortController();
    const { sse, options, done } = startStream(controller.signal);
    sse.push('data: {"delta":"A"}\n');
    await flush();
    expect(options.onDelta).toHaveBeenCalledTimes(1);
    controller.abort();
    sse.push('data: {"delta":"B"}\n');
    sse.close();
    await done;
    expect(options.onDelta).toHaveBeenCalledTimes(1);
    expect(options.onDone).not.toHaveBeenCalled();
  });

  /** 非 2xx（如 429）在读流之前就以 ApiError 拒绝 */
  it('非 2xx 抛 ApiError', async () => {
    mockFetch(() => jsonResponse({ detail: '今日额度已用完' }, 429));
    const options: StreamSseOptions = {
      signal: new AbortController().signal,
      token: 't',
      onDelta: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };
    await expect(streamSse('http://backend.test/api/x', {}, options)).rejects.toMatchObject({
      status: 429,
      detail: '今日额度已用完',
    });
    await expect(streamSse('http://backend.test/api/x', {}, options)).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
