/**
 * @file 路由：/login、/register 公开；/ 由 RequireAuth 保护；其余路径回 /。
 * AppRoutes 不含 Router，便于测试用 MemoryRouter 包裹；App 用 BrowserRouter 并挂载 Toast。
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toast } from '@/components/Toast';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ChatPage } from '@/features/chat/ChatPage';

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
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** 应用根 */
export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toast />
    </BrowserRouter>
  );
}
