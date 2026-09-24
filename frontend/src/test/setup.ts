/**
 * @file Vitest 公共设置：jest-dom 断言；每个用例后卸载组件、还原 mock 与全局桩、清空 localStorage。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
