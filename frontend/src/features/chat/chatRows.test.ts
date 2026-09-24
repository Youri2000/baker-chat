/**
 * @file layoutRows 测试：spec §7"头像显隐与间距"场景，以及同侧换说话人的 60 间距。
 */
import { describe, expect, it } from 'vitest';
import { layoutRows, type RowSpeaker } from '@/features/chat/chatRows';

const ME = 'mine.webp';
const AI = 'other.webp';

/** 快速构造一行 */
function row(side: RowSpeaker['side'], avatar: string): RowSpeaker {
  return { side, avatar };
}

describe('layoutRows', () => {
  /** 我方、我方、AI、AI、我方：头像在第 1、3、5 条；间距 14 / 33 / 14 / 33 */
  it('方向变化时显示头像，同一说话人连续不重复', () => {
    const result = layoutRows([
      row('mine', ME),
      row('mine', ME),
      row('other', AI),
      row('other', AI),
      row('mine', ME),
    ]);
    expect(result.map((r) => r.showAvatar)).toEqual([true, false, true, false, true]);
    expect(result.map((r) => r.gap)).toEqual([0, 14, 33, 14, 33]);
  });

  /** 同一侧换了说话人（头像不同）：显示头像，间距 60 */
  it('同侧换说话人时显示头像并用 60 间距', () => {
    const result = layoutRows([row('other', AI), row('other', 'another.webp')]);
    expect(result[1]).toEqual({ showAvatar: true, gap: 60 });
  });

  /** 空列表与单行 */
  it('首行头像常显且间距为 0', () => {
    expect(layoutRows([])).toEqual([]);
    expect(layoutRows([row('other', AI)])).toEqual([{ showAvatar: true, gap: 0 }]);
  });
});
