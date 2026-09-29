/**
 * @file 气泡 SVG 几何（ChatBubble 与 LoadingBubble 共用）：rect 固定从 x = 尾巴偏移开始，
 * SVG 总宽随 rect 宽推导；我方侧尾巴用 CSS transform 镜像到右缘，平移量跟随当前 SVG 宽，
 * 尺寸过渡时尾巴始终贴住 rect 右缘。另存 ChatBubble 测得的文字块尺寸缓存（组件文件只导出组件）。
 */
import { BUBBLE } from '@/constants/design';
import type { MessageSide } from '@/features/chat/api';

/** 文字块的实际渲染尺寸 */
export interface InnerSize {
  w: number;
  h: number;
}

/**
 * 已测量的文字块尺寸：同一朝向、同一文本排出来的尺寸相同，键为 "朝向:文本"；
 * 只由 ChatBubble 写入，打字机正在写的前缀不写入
 */
export const measuredSizes = new Map<string, InnerSize>();

/** SVG 总宽 = 尾巴偏移 + rect 宽（我方侧右边再留一个尾巴偏移） */
export function bubbleSvgWidth(rectW: number, side: MessageSide): number {
  return BUBBLE.tailOffset + rectW + (side === 'mine' ? BUBBLE.tailOffset : 0);
}

/**
 * 尾巴 path 的 CSS transform：对方侧原样贴在左缘；我方侧以当前 SVG 宽为轴镜像到右缘。
 * 配合 transform-box: view-box + transform-origin: 0 0 使 CSS transform 与 SVG 属性 transform 等价。
 */
export function tailTransform(side: MessageSide, svgW: number): string | undefined {
  return side === 'mine' ? `translate(${svgW}px, 0px) scale(-1, 1)` : undefined;
}
