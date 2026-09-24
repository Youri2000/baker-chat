/**
 * @file 一行消息：flex 行内放气泡（对方靠左、我方靠右），头像绝对定位在行外侧、不参与行高。
 * 行前间距与头像显隐由 chatRows.layoutRows 算出后传入；气泡或加载气泡由 MessageList 作为 children 传入。
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { AVATAR, CHAT_ANCHOR, CHAT_SCROLL } from '@/constants/design';
import type { MessageSide } from '@/features/chat/api';
import { ChatAvatar } from '@/features/chat/ChatAvatar';

/** 头像盒与气泡的相对位置（画布坐标换算为滚动容器内坐标） */
const ROW = {
  /** 对方头像盒左缘 / 对方气泡左缘 */
  otherAvatarX: CHAT_ANCHOR.otherAvatarX - CHAT_SCROLL.x,
  otherBubbleX: CHAT_ANCHOR.otherBubbleX - CHAT_SCROLL.x,
  /** 我方头像盒左缘 / 我方气泡右缘到容器右缘的距离 */
  mineAvatarX: CHAT_ANCHOR.mineAvatarX - CHAT_SCROLL.x,
  mineBubblePadRight: CHAT_SCROLL.w - (CHAT_ANCHOR.mineBubbleRight - CHAT_SCROLL.x),
  /** 头像盒顶部在气泡顶部上方的距离 */
  avatarLift: AVATAR.topToBubble,
} as const;

/** ChatMessageRow 属性 */
export interface ChatMessageRowProps {
  side: MessageSide;
  /** 说话人头像 URL */
  avatar: string;
  showAvatar: boolean;
  /** 与上一行的间距（px） */
  gap: number;
  /** 我方头像点击：切换管理员性别 */
  onAvatarClick?: () => void;
  /** ChatBubble 或 LoadingBubble */
  children: ReactNode;
}

/** 消息行 */
export function ChatMessageRow({
  side,
  avatar,
  showAvatar,
  gap,
  onAvatarClick,
  children,
}: ChatMessageRowProps) {
  return (
    <div
      className={clsx('relative flex items-start', side === 'mine' && 'justify-end')}
      style={{
        marginTop: gap,
        paddingLeft: side === 'other' ? ROW.otherBubbleX : undefined,
        paddingRight: side === 'mine' ? ROW.mineBubblePadRight : undefined,
      }}
    >
      {showAvatar && (
        <ChatAvatar
          src={avatar}
          style={{
            left: side === 'mine' ? ROW.mineAvatarX : ROW.otherAvatarX,
            top: -ROW.avatarLift,
          }}
          onClick={side === 'mine' ? onAvatarClick : undefined}
        />
      )}
      {children}
    </div>
  );
}
