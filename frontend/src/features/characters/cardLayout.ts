/**
 * @file 角色列表的纵向布局计算：由每张主卡的折叠状态与子卡数量算出主卡块的 top、子卡在块内的 top
 * 和尾部留白位置。数值全部来自 constants/design.ts 的 CHARACTER_LIST（原项目 characterCard.ts）。
 * 列表内所有卡片都是绝对定位，因此高度不由文档流得出，必须在这里显式累加。
 */
import { CHARACTER_LIST } from '@/constants/design';

const { topPad, cardH, subTopFromCard, subH, subGap, blockGap } = CHARACTER_LIST;

/** 展开时 n 张子卡连同子卡间距占用的高度 */
function subAreaHeight(subCount: number): number {
  return subCount * subH + Math.max(0, subCount - 1) * subGap;
}

/** 第 k 张（0 起）子卡相对主卡顶部的 top */
export function subTopInCard(k: number): number {
  return subTopFromCard + k * (subH + subGap);
}

/** 主卡块占位高度：折叠时只含主卡与块间距；展开时再加子卡区域与块间距 */
function blockHeight(collapsed: boolean, subCount: number): number {
  if (collapsed) return subTopFromCard;
  return subTopFromCard + subAreaHeight(subCount) + blockGap;
}

/** 每张主卡在列表容器内的 top（已含顶部留白），按块高度顺序累加 */
export function computeUnitTops(collapsed: boolean[], subCounts: number[]): number[] {
  let cursor = topPad;
  return collapsed.map((isCollapsed, i) => {
    const top = cursor;
    cursor += blockHeight(isCollapsed, subCounts[i]);
    return top;
  });
}

/** 尾部留白的 top = 最后一张主卡块的可见底边（不含块间距），留白本身撑出滚动高度 */
export function computeCardPadTop(
  collapsed: boolean[],
  subCounts: number[],
  unitTops: number[],
): number {
  const last = collapsed.length - 1;
  const visibleHeight = collapsed[last] ? cardH : subTopFromCard + subAreaHeight(subCounts[last]);
  return unitTops[last] + visibleHeight;
}
