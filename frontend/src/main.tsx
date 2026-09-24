/**
 * @file 入口：引入全局样式，启动登录态校验（有 token 就调 /me），挂载 App。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import { App } from '@/App';
import { useAuthStore } from '@/features/auth/authStore';

// 在挂载前发起，避免 StrictMode 下 effect 双调导致 /me 请求两次
void useAuthStore.getState().bootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
