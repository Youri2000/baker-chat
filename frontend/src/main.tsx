/**
 * @file 入口：引入全局样式，启动登录态校验（有 token 就调 /me），挂载 App。
 * 已登录时在挂载前与 /me 并行下载聊天页代码，最多等 CHAT_PAGE_WAIT 再挂载。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import { App } from '@/App';
import { useAuthStore } from '@/features/auth/authStore';
import { ChatPageLoader } from '@/features/chat/loadChatPage';
import { tokenStorage } from '@/lib/http';

/** 已登录时挂载前最多等聊天页代码多久（ms），与 PendingDots 的显示延迟一致 */
const CHAT_PAGE_WAIT = 200;

/** 挂载 App */
function mount(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// 在挂载前发起，避免 StrictMode 下 effect 双调导致 /me 请求两次
void useAuthStore.getState().bootstrap();

// ⚠️ 聊天页代码先到再挂载，首次渲染直接渲染真实组件、不进入 Suspense 兜底（React 19 的兜底一旦显示，内容至少 300ms 后才替换）。
// 超过 CHAT_PAGE_WAIT 仍未到就先挂载，由兜底显示加载动画；未登录时直接挂载登录页
if (tokenStorage.get() === null) {
  mount();
} else {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, CHAT_PAGE_WAIT));
  void Promise.race([ChatPageLoader.preload(), timeout]).then(mount, mount);
}
