/**
 * @file 路由守卫：没有 token 就重定向到 /login（replace，避免后退回到受保护页）。
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '@/features/auth/authStore';

/** RequireAuth 属性 */
export interface RequireAuthProps {
  children: ReactNode;
}

/** 登录守卫 */
export function RequireAuth({ children }: RequireAuthProps) {
  const token = useAuthStore((s) => s.token);
  if (token === null) return <Navigate to="/login" replace />;
  return children;
}
