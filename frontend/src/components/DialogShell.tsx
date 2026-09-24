/**
 * @file 对话框外壳：遮罩 + 居中深色面板 + 右上角关闭钮 + 标题 + 内容。
 * 默认样式逐项对应原 _mixins.scss 的 dialog-shell（对话管理 dc 与"请先选中角色卡片" ns 用它，
 * 标题下边距即 mixin 的 $title-mb 参数）；variant="settings" 对应原 SettingsDialog.vue 自带的外壳：
 * 标题 20px/600/下距 16、关闭钮 24px 半透明无底、面板限高 80vh 且纵向 flex。
 * 按钮见 DialogButton。open 为 false 时不渲染。
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';

/** DialogShell 属性 */
export interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  /** 标题；省略则不渲染标题行 */
  title?: string;
  /** 面板宽（px），原项目：对话管理 348 / 设置 560 / 提示 280 */
  width?: number;
  /** 标题下边距（px），对应 mixin 的 $title-mb：对话管理 10 / 数据管理 14；settings 变体固定 16 */
  titleGap?: number;
  /** settings：原设置对话框自带的外壳样式（见文件注释） */
  variant?: 'default' | 'settings';
  children: ReactNode;
}

/** 对话框外壳；点击遮罩空白处或 × 关闭 */
export function DialogShell({
  open,
  onClose,
  title,
  width = 348,
  titleGap = 14,
  variant = 'default',
  children,
}: DialogShellProps) {
  if (!open) return null;
  const settings = variant === 'settings';
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
        className={clsx(
          'relative rounded-dialog border border-chat-frame bg-card-bg px-8 pt-7 pb-5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]',
          settings && 'flex max-h-[80vh] flex-col',
        )}
        style={{ width }}
      >
        <button
          type="button"
          aria-label="关闭"
          className={
            settings
              ? 'absolute top-3 right-4 cursor-pointer text-[24px] leading-none text-text-primary opacity-50 hover:opacity-100'
              : 'absolute top-2 right-2.5 h-7 w-7 cursor-pointer rounded-full text-[22px] leading-none text-subcard-text hover:bg-hover-overlay'
          }
          onClick={onClose}
        >
          ×
        </button>
        {title !== undefined &&
          (settings ? (
            <h2 className="mb-4 text-[20px] font-semibold text-text-primary">{title}</h2>
          ) : (
            <h2
              className="text-[22px] font-medium text-text-primary"
              style={{ marginBottom: titleGap }}
            >
              {title}
            </h2>
          ))}
        {children}
      </div>
    </div>
  );
}
