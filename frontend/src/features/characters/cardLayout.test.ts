/**
 * @file cardLayout 测试：折叠/展开与子卡数量对主卡 top、子卡 top 和尾部留白的影响，数值对照原 characterCard.ts。
 */
import { describe, expect, it } from 'vitest';
import { computeCardPadTop, computeUnitTops, subTopInCard } from '@/features/characters/cardLayout';

describe('cardLayout', () => {
  /** 全部折叠：每块只占 100.86，从顶部留白 10 开始 */
  it('全部折叠时主卡按 100.86 等距排列', () => {
    expect(computeUnitTops([true, true, true], [1, 1, 1])).toEqual([10, 110.86, 211.72]);
  });

  /** 展开 2 张子卡：块高 = 100.86 + 2×68.95 + 4.61 + 7.87 */
  it('展开的主卡按子卡数量撑开后续主卡', () => {
    const tops = computeUnitTops([false, true], [2, 1]);
    expect(tops[0]).toBe(10);
    expect(tops[1]).toBeCloseTo(10 + 100.86 + 2 * 68.95 + 4.61 + 7.87, 5);
  });

  /** 子卡 top：首张 100.86，之后每张加 68.95 + 4.61 */
  it('subTopInCard 按子卡高与间距递增', () => {
    expect(subTopInCard(0)).toBe(100.86);
    expect(subTopInCard(1)).toBeCloseTo(100.86 + 73.56, 5);
    expect(subTopInCard(2)).toBeCloseTo(100.86 + 2 * 73.56, 5);
  });

  /** 尾部留白紧贴最后一块的可见底边：折叠为主卡高，展开为子卡区域底边 */
  it('computeCardPadTop 取最后一块的可见底边', () => {
    const collapsedTops = computeUnitTops([true, true], [1, 1]);
    expect(computeCardPadTop([true, true], [1, 1], collapsedTops)).toBeCloseTo(110.86 + 92.99, 5);
    const expandedTops = computeUnitTops([true, false], [1, 3]);
    expect(computeCardPadTop([true, false], [1, 3], expandedTops)).toBeCloseTo(
      110.86 + 100.86 + 3 * 68.95 + 2 * 4.61,
      5,
    );
  });
});
