/**
 * @file ChatBubble 测试：打字机正在写的气泡不把未写完的前缀写入尺寸缓存，写完的整行才缓存。
 * jsdom 没有 ResizeObserver，用桩在 observe 时立即回调一个固定尺寸。
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measuredSizes } from '@/features/chat/bubbleSvg';
import { ChatBubble } from '@/features/chat/ChatBubble';

/** observe 时立即以 120×30 回调，模拟浏览器首次布局后的测量 */
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback(
      [{ contentRect: { width: 120, height: 30 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe('ChatBubble', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    measuredSizes.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 逐字写出"你 → 你好 → 你好呀"：前缀不进缓存，写完（typing 变为 false）后缓存整行 */
  it('正在写的前缀不写入尺寸缓存', () => {
    const { rerender } = render(<ChatBubble side="other" text="你" animate typing />);
    act(() => rerender(<ChatBubble side="other" text="你好" animate typing />));
    act(() => rerender(<ChatBubble side="other" text="你好呀" animate typing />));
    expect(measuredSizes.size).toBe(0);
    act(() => rerender(<ChatBubble side="other" text="你好呀" animate typing={false} />));
    expect([...measuredSizes.keys()]).toEqual(['other:你好呀']);
  });
});
