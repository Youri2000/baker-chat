/**
 * @file 注册页 /register：用户名（3–20 位字母/数字/下划线）、密码（6–64 个字符，UTF-8 不超过 72 字节）、确认密码。
 * 本地校验失败在对应输入框下方提示；用户名被占用来自后端 409。注册成功即登录并跳 /。
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { DialogButton } from '@/components/DialogButton';
import { ApiError } from '@/lib/http';
import { FormField } from '@/features/auth/FormField';
import { useAuthStore } from '@/features/auth/authStore';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_ERROR = '密码为 6–64 位；含中文时最多 24 个字';

/** 6–64 个字符（按码点计）、不限字符集；bcrypt 只接受 72 字节，UTF-8 超长在这里拦下，与后端 AuthRequest 同一条规则 */
function isValidPassword(password: string): boolean {
  const length = [...password].length;
  return length >= 6 && length <= 64 && new TextEncoder().encode(password).length <= 72;
}

/** 三个字段的错误 */
interface RegisterErrors {
  username?: string;
  password?: string;
  confirm?: string;
}

/** 本地校验规则（与后端 docs/api.md §1 一致） */
function validate(username: string, password: string, confirm: string): RegisterErrors {
  const errors: RegisterErrors = {};
  if (!USERNAME_RE.test(username)) errors.username = '用户名为 3–20 位字母、数字或下划线';
  if (!isValidPassword(password)) errors.password = PASSWORD_ERROR;
  if (confirm !== password) errors.confirm = '两次输入的密码不一致';
  return errors;
}

/** 注册页 */
export function RegisterPage() {
  const token = useAuthStore((s) => s.token);
  const register = useAuthStore((s) => s.register);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [submitting, setSubmitting] = useState(false);

  if (token !== null) return <Navigate to="/" replace />;

  /** 提交：先本地校验，再提交；409 显示在用户名下方 */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate(username, password, confirm);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      await register(username, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrors({ username: err.detail });
      } else {
        setErrors({ confirm: err instanceof ApiError ? err.detail : '网络错误，请稍后重试' });
      }
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
          <h1 className="mt-1 text-[22px] font-medium text-text-primary">注册</h1>
        </div>
        <FormField
          id="username"
          label="用户名"
          autoComplete="username"
          placeholder="3–20 位字母、数字或下划线"
          value={username}
          error={errors.username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <FormField
          id="password"
          label="密码"
          type="password"
          autoComplete="new-password"
          placeholder="6–64 位，含中文时最多 24 个字"
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormField
          id="confirm"
          label="确认密码"
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <DialogButton type="submit" variant="primary" disabled={submitting} className="mt-2">
          {submitting ? '注册中…' : '注册'}
        </DialogButton>
        <p className="text-center text-[13px] text-subcard-text/70">
          已有账号？
          <Link to="/login" className="text-accent hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </main>
  );
}
