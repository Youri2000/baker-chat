/**
 * @file 登录态：token（持久化在 localStorage，由 lib/http 读写）+ user。
 * 提供登录、注册、退出、启动校验；并向 lib/http 注册 401 处理器（清登录态 + 提示）。
 * 登录态变化（登录、注册、退出、过期）时把 chatStore 与 settingsStore 重置，上一个用户的数据不会留到下一个用户。
 * 路由守卫只看 token：token 为 null 即跳 /login。
 */
import { create } from 'zustand';
import { toast } from '@/components/toastStore';
import { onUnauthorized, tokenStorage } from '@/lib/http';
import { login as apiLogin, me, register as apiRegister, type User } from '@/features/auth/api';
import { useChatStore } from '@/features/chat/chatStore';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 登录态 store */
export interface AuthState {
  token: string | null;
  user: User | null;
  /** 登录成功后写入 token 与 user；失败抛 ApiError（401 用户名或密码错误） */
  login: (username: string, password: string) => Promise<void>;
  /** 注册成功即登录；失败抛 ApiError（409 用户名已被占用） */
  register: (username: string, password: string) => Promise<void>;
  /** 清 token 与 user，守卫随即跳 /login */
  logout: () => void;
  /** 启动时：有 token 就调 /me 校验并取回 user；401 由 http 层清除登录态 */
  bootstrap: () => Promise<void>;
}

/** ✅ 清掉上一个用户的会话、消息与设置（chatStore.reset 同时中止进行中的回复流）；新用户的数据到达前页面不显示旧数据 */
function resetUserData(): void {
  useChatStore.getState().reset();
  useSettingsStore.getState().reset();
}

/** 登录态 */
export const useAuthStore = create<AuthState>()((set) => ({
  token: tokenStorage.get(),
  user: null,
  login: async (username, password) => {
    const { token, user } = await apiLogin(username, password);
    resetUserData();
    tokenStorage.set(token);
    set({ token, user });
  },
  register: async (username, password) => {
    const { token, user } = await apiRegister(username, password);
    resetUserData();
    tokenStorage.set(token);
    set({ token, user });
  },
  logout: () => {
    resetUserData();
    tokenStorage.clear();
    set({ token: null, user: null });
  },
  bootstrap: async () => {
    if (tokenStorage.get() === null) return;
    try {
      set({ user: await me() });
    } catch {
      // 401 已由 http 层处理；其他失败（如后端未启动）保持现状，后续请求会再次暴露
    }
  },
}));

// ⚠️ 401 时 http 层已清掉 localStorage 里的 token，这里同步内存状态并提示；守卫看到 token 为 null 即重定向。
// 并发的多个 401 只处理一次：第一个已把内存里的 token 置空；退出登录后残留请求的 401 同样不再提示
onUnauthorized(() => {
  if (useAuthStore.getState().token === null) return;
  resetUserData();
  useAuthStore.setState({ token: null, user: null });
  toast('登录已过期，请重新登录');
});
