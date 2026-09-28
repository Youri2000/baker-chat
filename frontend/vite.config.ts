/**
 * @file Vite 与 Vitest 共用配置：React 插件、Tailwind v4 插件、已登录时预载聊天页 chunk 的构建插件、`@/` 别名与 jsdom 测试环境。
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * 构建时往 index.html 注入一段内联脚本：localStorage 里有登录 token 就给聊天页 chunk 加 modulepreload，
 * 让它与入口 JS 同时下载；没有 token（登录页）不预载，入口 JS 独占带宽。
 * ⚠️ 不加时聊天页 chunk 要等入口执行完才开始下载，慢速 4G 下已登录刷新比拆包前慢约 280ms
 */
function preloadChatPageWhenLoggedIn(): Plugin {
  return {
    name: 'preload-chat-page-when-logged-in',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle!).find(
          (item) => item.type === 'chunk' && item.name === 'ChatPage',
        );
        // 聊天页改名或不再拆包时构建直接失败，而不是悄悄少了预载
        if (chunk === undefined)
          throw new Error('没有找到 ChatPage chunk，预载聊天页的脚本无法生成');
        // 键名与 lib/http.ts 的 TOKEN_KEY 一致；只在 head 里追加一个 link，不执行模块
        const script = `localStorage.getItem('baker.token')&&document.head.appendChild(Object.assign(document.createElement('link'),{rel:'modulepreload',href:'/${chunk.fileName}'}))`;
        return { html, tags: [{ tag: 'script', children: script, injectTo: 'head-prepend' }] };
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadChatPageWhenLoggedIn()],
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
