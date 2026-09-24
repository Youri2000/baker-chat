/**
 * @file 设置对话框表单控件（input / textarea / select）共用的 Tailwind 类，
 * 对应原 SettingsDialog.vue 里 sd__input / sd__textarea / sd__select 的公共部分：
 * 6% 白底、12% 白边、8px 圆角、聚焦 30% 白边、占位 25% 白、0.2s 边框过渡。
 * 字号与内边距各控件不同，由使用处补充。
 */

/** 表单控件公共外观 */
export const CONTROL_CLASS =
  'bg-text-primary/6 border-text-primary/12 text-text-primary placeholder:text-text-primary/25 focus:border-text-primary/30 duration-(--anim-fast) rounded-lg border outline-none transition-[border-color]';
