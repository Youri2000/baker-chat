/**
 * @file 设置对话框内的矩形按钮，对应原 SettingsDialog.vue 的 sd__btn / sd__btn--primary：
 * 8px 圆角、14px 字、0.2s 过渡、禁用 40% 透明。与共享的 DialogButton（胶囊）外观不同，
 * 只在设置对话框各标签页内使用；透传原生 button 属性。
 */
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

/** SettingsButton 属性 */
export interface SettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default 半透明白底 / primary 黄底深字 */
  variant?: 'default' | 'primary';
}

/** 设置对话框按钮 */
export function SettingsButton({ variant = 'default', className, ...rest }: SettingsButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'cursor-pointer rounded-lg border px-5 py-2 text-[14px] transition-all duration-(--anim-fast) disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'default' &&
          'border-text-primary/15 bg-text-primary/6 text-text-primary hover:bg-text-primary/12',
        variant === 'primary' && 'border-accent bg-accent text-[#1a1a1a] hover:bg-[#e6d936]',
        className,
      )}
      {...rest}
    />
  );
}
