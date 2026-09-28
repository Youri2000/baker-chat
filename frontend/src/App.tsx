/**
 * @file 路由：/login、/register 公开；/ 由 RequireAuth 保护；其余路径回 /。
 * 聊天页按需加载：代码未就绪时由 PendingDots 兜底，等待超过 200ms 才显示加载动画。首次挂载前入口已经等过
 * 聊天页代码，所以首次挂载时从页面导航开始计时；登录后等站内跳转从兜底出现时计时。
 * AppRoutes 不含 Router，便于测试用 MemoryRouter 包裹；App 用 BrowserRouter 并挂载 Toast。
 */
import { Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { PendingDots } from '@/components/PendingDots';
import { Toast } from '@/components/Toast';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ChatPageLoader } from '@/features/chat/loadChatPage';

/** 是否还在首次挂载：入口挂载前已等过聊天页代码，这时的兜底从页面导航开始计时 */
let booting = true;

/** 路由表 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Suspense fallback={<PendingDots since={booting ? 0 : undefined} />}>
              <ChatPageLoader.Component />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** 应用根 */
export function App() {
  // 首次挂载完成后，之后的兜底都从出现时计时
  useEffect(() => {
    booting = false;
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes />
      <Toast />
    </BrowserRouter>
  );
}
