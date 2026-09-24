/**
 * @file Vite 与 Vitest 共用配置：React 插件、Tailwind v4 插件、`@/` 别名与 jsdom 测试环境。
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false, // 测试不需要真实样式，跳过 Tailwind 编译以加速
    env: { VITE_API_BASE_URL: 'http://backend.test' }, // 测试里 fetch 被桩替换，只需可解析的 URL
  },
});
