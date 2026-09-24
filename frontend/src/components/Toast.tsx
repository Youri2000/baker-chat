/**
 * @file 提示条渲染：固定在视口顶部居中，逐条堆叠，点击可提前关闭。放在 App 根部一次。
 */
import { useToastStore } from '@/components/toastStore';

/** 提示条列表 */
export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="fixed top-6 left-1/2 z-[300] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          role="status"
          className="animate-dialog-in rounded-lg border border-chat-frame bg-card-bg px-4 py-2 text-[14px] text-text-primary shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
