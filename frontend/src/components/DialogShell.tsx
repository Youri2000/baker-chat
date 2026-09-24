/**
 * @file 对话框外壳：遮罩 + 居中深色面板 + 右上角关闭钮 + 标题 + 内容 + 操作区，
 * 对应原 _mixins.scss 的 dialog-shell。对话管理、设置、"请先选中角色卡片"三个对话框共用；
 * 按钮见 DialogButton。open 为 false 时不渲染。
 */
import type { ReactNode } from 'react';

/** DialogShell 属性 */
export interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  /** 标题；省略则不渲染标题行 */
  title?: string;
  /** 面板宽（px），原项目：对话管理 348 / 数据管理 500 / 设置 560 / 提示 280 */
  width?: number;
  children: ReactNode;
  /** 操作区（一行按钮），省略则不渲染 */
  actions?: ReactNode;
}

/** 对话框外壳；点击遮罩空白处或 × 关闭 */
export function DialogShell({
  open,
  onClose,
  title,
  width = 348,
  children,
  actions,
}: DialogShellProps) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[200] flex animate-dialog-in items-center justify-center bg-dialog-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative rounded-dialog border border-chat-frame bg-card-bg px-8 pt-7 pb-5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
        style={{ width }}
      >
        <button
          type="button"
          aria-label="关闭"
          className="absolute top-2 right-2.5 h-7 w-7 cursor-pointer rounded-full text-[22px] leading-none text-subcard-text hover:bg-hover-overlay"
          onClick={onClose}
        >
          ×
        </button>
        {title !== undefined && (
          <h2 className="mb-[14px] text-[22px] font-medium text-text-primary">{title}</h2>
        )}
        {children}
        {actions !== undefined && <div className="mt-[18px] flex gap-3">{actions}</div>}
      </div>
    </div>
  );
}
