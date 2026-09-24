/**
 * @file 把 constants/design 里的矩形常量 {x, y, w, h} 转成绝对定位的内联 style，
 * 聊天区各层（聊天条、聊天框、空态、滚动容器、输入面板）共用。
 */
import type { CSSProperties } from 'react';

/** 设计稿矩形 */
export interface DesignBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 绝对定位盒的 left / top / width / height */
export function boxStyle(box: DesignBox): CSSProperties {
  return { left: box.x, top: box.y, width: box.w, height: box.h };
}
