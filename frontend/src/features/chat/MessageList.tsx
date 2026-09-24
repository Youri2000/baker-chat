/**
 * @file 消息滚动区：持久化消息 + 当前会话的流式临时气泡 + 加载气泡，按 chatRows 规则排成 flex 纵向流。
 * 由 ChatArea 以 key=会话 id 挂载，切换会话时重挂载触发 chat-in 入场；内容高度变化时自动滚到底部。
 * 💡 用 flex 流式布局替代原项目逐条计算绝对坐标，详见 docs/interview.md#flex-layout
 */
import { useEffect, useRef, useState } from 'react';
import { AVATAR, CHAT_ANCHOR, CHAT_SCROLL } from '@/constants/design';
import type { Message, MessageSide } from '@/features/chat/api';
import { boxStyle } from '@/features/chat/boxStyle';
import { ChatBubble } from '@/features/chat/ChatBubble';
import { ChatMessageRow } from '@/features/chat/ChatMessageRow';
import { layoutRows } from '@/features/chat/chatRows';
import { useChatStore } from '@/features/chat/chatStore';
import { LoadingBubble } from '@/features/chat/LoadingBubble';

/** 首条气泡顶部距滚动容器顶部：首条头像顶部（画布 243.42）换算到容器内，再加头像盒到气泡的偏移 */
const FIRST_BUBBLE_TOP = CHAT_ANCHOR.firstAvatarTop - CHAT_SCROLL.y + AVATAR.topToBubble;

/**
 * 内容尾部留白：原项目为"末尾装饰上下各 32 + 装饰高 26 + 尾部留白 100"，装饰只在已删除的导出模式显示，
 * 但空位保留，最后一条消息才不会被底部输入面板及其 60px 遮罩条盖住
 */
const TAIL_SPACE = 32 + 26 + 32 + CHAT_ANCHOR.bottomPad;

/** MessageList 属性 */
export interface MessageListProps {
  conversationId: number;
  messages: Message[];
  /** 角色头像 / 管理员头像 */
  otherAvatar: string;
  mineAvatar: string;
  onMineAvatarClick: () => void;
}

/** 一行要显示的内容 */
interface RowItem {
  side: MessageSide;
  text: string;
  avatar: string;
}

/** 消息滚动区 */
export function MessageList({
  conversationId,
  messages,
  otherAvatar,
  mineAvatar,
  onMineAvatarClick,
}: MessageListProps) {
  const streaming = useChatStore((s) => s.streaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 只有当前会话就是流所属会话时才显示临时气泡与加载气泡
  const own = streaming !== null && streaming.conversationId === conversationId;
  const bubbles = own ? streaming.bubbles : [];
  const pending = own && streaming.pending;

  const rows: RowItem[] = [
    ...messages.map((m) => ({
      side: m.side,
      text: m.text,
      avatar: m.side === 'mine' ? mineAvatar : otherAvatar,
    })),
    ...bubbles.map((text) => ({ side: 'other' as const, text, avatar: otherAvatar })),
  ];
  // 加载气泡也参与布局计算，取得它自己的头像显隐与间距
  const layouts = layoutRows(pending ? [...rows, { side: 'other', avatar: otherAvatar }] : rows);

  // 挂载时已有的行属于首屏（随 chat-in 一起出现），之后追加的行才做加载→真实尺寸的过渡
  const [initialCount] = useState(rows.length);

  // ✅ 内容高度变化（新行、气泡测量完成、加载气泡出现）时滚到底部
  useEffect(() => {
    const scroll = scrollRef.current!;
    const observer = new ResizeObserver(() => {
      scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(contentRef.current!);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      className="absolute z-[3] animate-chat-in [scrollbar-width:thin] [scrollbar-color:var(--color-scrollbar-chat)_transparent] overflow-x-hidden overflow-y-auto scroll-mask [--mask-bottom-in:calc(100%_-_80px)] [--mask-bottom-out:calc(100%_-_40px)] [--mask-right:14px] [--mask-top-in:20px] [--mask-top-out:40px]"
      style={boxStyle(CHAT_SCROLL)}
    >
      {/* 内容固定为容器设计宽，滚动条出现时不改变行内坐标 */}
      <div
        ref={contentRef}
        className="flex w-[1312px] flex-col"
        style={{ paddingTop: FIRST_BUBBLE_TOP, paddingBottom: TAIL_SPACE }}
      >
        {rows.map((row, i) => (
          // ⚠️ 以下标作 key：流结束后临时气泡原位换成持久化消息，组件与尺寸状态沿用，不会重新播放过渡
          <ChatMessageRow
            key={i}
            side={row.side}
            avatar={row.avatar}
            showAvatar={layouts[i].showAvatar}
            gap={layouts[i].gap}
            onAvatarClick={onMineAvatarClick}
          >
            <ChatBubble side={row.side} text={row.text} animate={i >= initialCount} />
          </ChatMessageRow>
        ))}
        {pending && (
          <ChatMessageRow
            key="loading"
            side="other"
            avatar={otherAvatar}
            showAvatar={layouts[rows.length].showAvatar}
            gap={layouts[rows.length].gap}
          >
            <LoadingBubble side="other" />
          </ChatMessageRow>
        )}
      </div>
    </div>
  );
}
