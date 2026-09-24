/**
 * @file 登录/注册表单的字段：标签 + 输入框 + 输入框下方的错误文案。
 */
import type { InputHTMLAttributes } from 'react';

/** FormField 属性：除 label/error 外全部透传给 input */
export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** 校验或后端返回的中文错误；有值时显示在输入框下方 */
  error?: string;
}

/** 表单字段 */
export function FormField({ label, error, id, ...inputProps }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-[13px] text-text-primary/60">{label}</span>
      <input
        id={id}
        aria-invalid={error !== undefined}
        className="w-full rounded-lg border border-text-primary/12 bg-text-primary/6 px-3 py-2 text-[14px] text-text-primary outline-none placeholder:text-text-primary/25 focus:border-text-primary/30"
        {...inputProps}
      />
      {error !== undefined && (
        <span role="alert" className="text-[13px] text-[#ff8f8f]">
          {error}
        </span>
      )}
    </label>
  );
}
