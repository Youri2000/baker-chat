/**
 * @file 全局提示队列：只用于真实失败（网络、鉴权过期、额度用完等），由 Toast.tsx 渲染。
 * 任何模块都可以直接调用 `toast(message)`。
 */
import { create } from 'zustand';
import { ApiError } from '@/lib/http';

/** 一条提示 */
export interface ToastItem {
  id: number;
  message: string;
}

/** 提示自动消失时间（ms） */
const TOAST_MS = 3000;

let nextId = 1;

/** 提示队列 store */
interface ToastState {
  toasts: ToastItem[];
  show: (message: string) => void;
  dismiss: (id: number) => void;
}

/** 提示队列：show 入队并在 TOAST_MS 后自动出队 */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, TOAST_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** 显示一条提示 */
export function toast(message: string): void {
  useToastStore.getState().show(message);
}

/**
 * 把请求失败转成提示：ApiError 用后端的中文 detail，其余（fetch 抛出的网络错误）统一提示。
 * 401 已由登录态处理并提示过，这里跳过避免重复。
 */
export function toastError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status !== 401) toast(err.detail);
    return;
  }
  toast('网络错误，请稍后重试');
}
