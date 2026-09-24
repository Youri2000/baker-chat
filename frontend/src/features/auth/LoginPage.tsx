/**
 * @file 登录页 /login：用户名 + 密码，展示演示账号并可一键填入。
 * 登录成功后 token 写入 store，本组件随即渲染 <Navigate to="/">；已登录访问也直接跳 /。
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { DialogButton } from '@/components/DialogButton';
import { ApiError } from '@/lib/http';
import { FormField } from '@/features/auth/FormField';
import { useAuthStore } from '@/features/auth/authStore';

/** 演示账号（后端 DEMO_USERNAME / DEMO_PASSWORD 的默认值） */
const DEMO = { username: 'demo', password: 'demo123' } as const;

/** 登录页 */
export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  if (token !== null) return <Navigate to="/" replace />;

  /** 提交：本地只校验非空，密码错误等原因来自后端 401 的 detail */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (username === '') next.username = '请输入用户名';
    if (password === '') next.password = '请输入密码';
    setErrors(next);
    if (next.username !== undefined || next.password !== undefined) return;
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setErrors({ password: err instanceof ApiError ? err.detail : '网络错误，请稍后重试' });
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center bg-bg-root">
      <form
        className="flex w-[360px] flex-col gap-4 rounded-dialog border border-chat-frame bg-card-bg px-8 pt-7 pb-6 shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
        onSubmit={handleSubmit}
        noValidate
      >
        <div>
          <p className="text-[12px] tracking-[2px] text-subcard-text/60">//BAKER/会话消息</p>
          <h1 className="mt-1 text-[22px] font-medium text-text-primary">登录</h1>
        </div>
        <FormField
          id="username"
          label="用户名"
          autoComplete="username"
          value={username}
          error={errors.username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <FormField
          id="password"
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <DialogButton type="submit" variant="primary" disabled={submitting} className="mt-2">
          {submitting ? '登录中…' : '登录'}
        </DialogButton>
        <div className="flex items-center justify-between rounded-lg bg-text-primary/6 px-3 py-2 text-[13px] text-subcard-text">
          <span>
            演示账号 {DEMO.username} / {DEMO.password}
          </span>
          <button
            type="button"
            className="cursor-pointer text-accent hover:underline"
            onClick={() => {
              setUsername(DEMO.username);
              setPassword(DEMO.password);
              setErrors({});
            }}
          >
            一键填入
          </button>
        </div>
        <p className="text-center text-[13px] text-subcard-text/70">
          没有账号？
          <Link to="/register" className="text-accent hover:underline">
            去注册
          </Link>
        </p>
      </form>
    </main>
  );
}
