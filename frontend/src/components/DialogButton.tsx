/**
 * @file 对话框胶囊按钮：对应 dialog-shell mixin 的 __btn / --primary，外加删除类的 danger 变体。
 * 透传原生 button 属性（disabled、title 等）。
 */
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

/** DialogButton 属性 */
export interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default 浅灰 / primary 黄色主按钮 / danger 深红删除 */
  variant?: 'default' | 'primary' | 'danger';
}

/** 对话框按钮 */
export function DialogButton({ variant = 'default', className, ...rest }: DialogButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'min-w-[132px] cursor-pointer rounded-full px-[18px] py-2.5 text-[16px] transition-[filter] duration-(--anim-dialog) hover:brightness-[0.92] disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'default' && 'bg-btn-bg text-btn-icon',
        variant === 'primary' && 'bg-subcard-selected text-subcard-text-selected',
        variant === 'danger' && 'bg-danger text-btn-bg',
        className,
      )}
      {...rest}
    />
  );
}
