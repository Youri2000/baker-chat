/**
 * @file useChatAutoScroll 测试：宿主组件把 scrollRef / contentRef 绑到两个 div 上，按钮显隐读 isAtBottom。
 * jsdom 没有布局：给滚动容器实例定义可控的 scrollHeight / clientHeight / scrollTop（scrollTop 按真实浏览器钳制在
 * 0 到 scrollHeight − clientHeight 之间），ResizeObserver 换成记录回调的桩，由用例手动触发"内容尺寸变化"。
 * 覆盖：挂载滚到底部、跟随时内容变高保持在底部、向上滚动超过阈值才暂停、阈值内仍跟随、滚回底部附近恢复、
 * 程序滚动不误判、scrollToBottom 瞬时与平滑、靠近顶部通知、内容缩短恢复跟随、卸载清理。
 * 插入更早历史后保持可见位置由虚拟列表负责，见 e2e/tests/scroll.spec.ts。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAutoScroll, type ChatAutoScrollOptions } from '@/features/chat/useChatAutoScroll';

/** 记录 ResizeObserver 回调与断开次数的桩 */
const resize = vi.hoisted(() => ({
  callbacks: [] as Array<() => void>,
  disconnect: vi.fn(),
}));

/** ResizeObserver 桩：observe 时登记回调，由 fireResize 手动触发 */
class ResizeObserverStub {
  private readonly callback: () => void;
  /** 保存回调 */
  constructor(callback: () => void) {
    this.callback = callback;
  }
  /** 登记回调 */
  observe() {
    resize.callbacks.push(this.callback);
  }
  /** 不需要 */
  unobserve() {}
  /** 记录断开 */
  disconnect() {
    resize.disconnect();
  }
}

/** 触发全部内容尺寸回调 */
function fireResize() {
  act(() => resize.callbacks.forEach((cb) => cb()));
}

/** 滚动容器的可控几何 */
interface Geometry {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/** 当前滚动容器的几何；每个用例重置 */
let geometry: Geometry;

/** 给元素实例定义可控的滚动几何（原型上的属性在 jsdom 里恒为 0） */
function attachGeometry(el: HTMLElement) {
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight },
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => geometry.scrollTop,
      set: (value: number) => {
        geometry.scrollTop = Math.max(
          0,
          Math.min(value, geometry.scrollHeight - geometry.clientHeight),
        );
      },
    },
  });
}

/** 宿主：滚动容器与内容，按钮只在暂停跟随时出现 */
function Host(props: ChatAutoScrollOptions) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useChatAutoScroll(props);
  return (
    <>
      <div
        data-testid="scroll"
        ref={(el) => {
          if (el !== null) attachGeometry(el);
          scrollRef.current = el;
        }}
      >
        <div ref={contentRef} />
      </div>
      {!isAtBottom && (
        <button type="button" onClick={() => scrollToBottom(true)}>
          回到底部
        </button>
      )}
      <button type="button" onClick={() => scrollToBottom()}>
        发送
      </button>
    </>
  );
}

/** 用户把滚动位置改到 top 并触发 scroll 事件 */
function userScrollTo(top: number) {
  const el = screen.getByTestId('scroll');
  el.scrollTop = top;
  fireEvent.scroll(el);
}

/** 当前距底部的距离 */
function distanceToBottom() {
  return geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight;
}

describe('useChatAutoScroll', () => {
  beforeEach(() => {
    geometry = { scrollHeight: 2000, clientHeight: 800, scrollTop: 0 };
    resize.callbacks.length = 0;
    resize.disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  /** 打开会话：绘制前滚到底部，不显示按钮 */
  it('挂载时滚到底部', () => {
    render(<Host conversationId={1} />);
    expect(geometry.scrollTop).toBe(1200);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  /** 跟随时新内容把高度撑大，保持在底部 */
  it('跟随时内容变高保持在底部', () => {
    render(<Host conversationId={1} />);
    geometry.scrollHeight = 2300;
    fireResize();
    expect(distanceToBottom()).toBe(0);
  });

  /** 向上滚动离开底部超过 80：暂停跟随，出现按钮，之后内容变高不再拉回底部 */
  it('向上滚动超过阈值后暂停跟随', () => {
    render(<Host conversationId={1} />);
    userScrollTo(1000);
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument();
    geometry.scrollHeight = 2300;
    fireResize();
    expect(geometry.scrollTop).toBe(1000);
  });

  /** 向上滚动不超过 80 仍算接近底部：继续跟随，不出现按钮 */
  it('阈值内向上滚动仍跟随', () => {
    render(<Host conversationId={1} />);
    userScrollTo(1150);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
    geometry.scrollHeight = 2300;
    fireResize();
    expect(distanceToBottom()).toBe(0);
  });

  /** 暂停后用户自己滚回距底部 80 以内：按钮消失，恢复跟随 */
  it('滚回底部附近恢复跟随', () => {
    render(<Host conversationId={1} />);
    userScrollTo(900);
    userScrollTo(1150);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
    geometry.scrollHeight = 2300;
    fireResize();
    expect(distanceToBottom()).toBe(0);
  });

  /** 距底部超过 80 但 scrollTop 变大（程序滚动或内容上方增高补偿）：不算用户离开底部 */
  it('向下的滚动不会暂停跟随', () => {
    geometry.scrollTop = 0;
    render(<Host conversationId={1} />);
    geometry.scrollHeight = 4000;
    userScrollTo(1500);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  /** scrollToBottom()：瞬时滚到底部并恢复跟随（我方发送） */
  it('scrollToBottom 瞬时滚到底部并恢复跟随', () => {
    render(<Host conversationId={1} />);
    userScrollTo(500);
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(distanceToBottom()).toBe(0);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  /** 点击按钮：用 behavior=smooth 平滑滚动到底部，按钮立即隐藏 */
  it('点击按钮平滑滚到底部', () => {
    const scrollTo = vi.fn();
    render(<Host conversationId={1} />);
    screen.getByTestId('scroll').scrollTo = scrollTo;
    userScrollTo(500);
    fireEvent.click(screen.getByRole('button', { name: '回到底部' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  /** 滚到距顶部 200 以内：调用 onReachTop；更远时不调用 */
  it('靠近顶部时通知加载更早的历史', () => {
    const onReachTop = vi.fn();
    render(<Host conversationId={1} onReachTop={onReachTop} />);
    userScrollTo(600);
    expect(onReachTop).not.toHaveBeenCalled();
    userScrollTo(150);
    expect(onReachTop).toHaveBeenCalledTimes(1);
  });

  /** 暂停时内容缩短到接近底部（如清空消息）：没有 scroll 事件也恢复跟随 */
  it('内容缩短到底部附近时恢复跟随', () => {
    render(<Host conversationId={1} />);
    userScrollTo(300);
    geometry.scrollHeight = 1000;
    geometry.scrollTop = 200;
    fireResize();
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  /** 卸载：断开 ResizeObserver，移除滚动监听 */
  it('卸载时清理监听与 observer', () => {
    const { unmount } = render(<Host conversationId={1} />);
    const el = screen.getByTestId('scroll');
    const remove = vi.spyOn(el, 'removeEventListener');
    unmount();
    expect(resize.disconnect).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
