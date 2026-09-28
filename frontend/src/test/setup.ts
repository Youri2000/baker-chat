/**
 * @file Vitest 公共设置：jest-dom 断言；每个用例后卸载组件、还原 mock 与全局桩、清空 localStorage。
 * jsdom 没有布局，offsetWidth / offsetHeight 恒为 0；消息列表的虚拟列表按滚动容器高度决定渲染哪些行，
 * 高度为 0 时一行都不渲染。这里让两者返回元素内联 style 的宽高：滚动容器（内联 831px 高）有尺寸，
 * 消息行（没有内联高度）量得 0，全部落在可视区内，测试里所有行都会渲染。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return parseFloat(this.style.height) || 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return parseFloat(this.style.width) || 0;
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
