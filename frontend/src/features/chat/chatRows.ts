/**
 * @file 消息行布局规则（纯函数）：决定每一行是否显示头像以及与上一行的间距。
 * MessageList 用它统一排版持久化消息、流式临时气泡和加载气泡；说话人身份用头像 URL 表示，
 * 因此"同侧换说话人"与"同一说话人连续"都能用同一份数据判断。
 */
import { CHAT_GAP } from '@/constants/design';
import type { MessageSide } from '@/features/chat/api';

/** 参与布局的一行：方向 + 说话人（头像 URL） */
export interface RowSpeaker {
  side: MessageSide;
  avatar: string;
}

/** 一行的布局结果 */
export interface RowLayout {
  /** 方向变化或同侧换说话人时显示头像；同一说话人连续发言不重复 */
  showAvatar: boolean;
  /** 与上一行的间距：同一说话人 14 / 跨方向 33 / 同侧换说话人 60；首行 0 */
  gap: number;
}

/** ✅ 按"上一行 → 本行"的关系逐行计算头像显隐与间距 */
export function layoutRows(rows: readonly RowSpeaker[]): RowLayout[] {
  return rows.map((row, i) => {
    if (i === 0) return { showAvatar: true, gap: 0 };
    const prev = rows[i - 1];
    if (prev.side !== row.side) return { showAvatar: true, gap: CHAT_GAP.cross };
    if (prev.avatar !== row.avatar) return { showAvatar: true, gap: CHAT_GAP.speaker };
    return { showAvatar: false, gap: CHAT_GAP.same };
  });
}
