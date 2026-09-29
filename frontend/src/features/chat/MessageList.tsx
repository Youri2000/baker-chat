/**
 * @file 消息滚动区：已加载的持久化消息 + 当前会话的流式临时气泡 + 加载气泡，按 chatRows 规则排版。
 * 由 ChatArea 以 key=会话 id 挂载，切换会话时重挂载触发 chat-in 入场。
 * 长会话用虚拟列表只渲染可视区附近的行：行高按实际测量结果更新，头像显隐与间距仍按完整列表计算；
 * 滚动规则（跟随底部、暂停、回到底部、靠近顶部加载更早历史）全部在 useChatAutoScroll 中，这里只渲染消息和按钮；
 * 插入更早的历史后保持可见消息不动交给虚拟列表的 anchorTo，它掌握每行的测量结果，能在渲染前修正偏移。
 * 💡 用 flex 流式布局替代原项目逐条计算绝对坐标，详见 docs/interview.md#flex-layout
 * 💡 长会话用无头虚拟列表 + 消息游标分页，前后对比数据详见 docs/interview.md#virtual-list
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AVATAR, BUBBLE, CHAT_ANCHOR, CHAT_SCROLL } from '@/constants/design';
import type { Message, MessageSide } from '@/features/chat/api';
import { BackToBottomButton } from '@/features/chat/BackToBottomButton';
import { boxStyle } from '@/features/chat/boxStyle';
import { ChatBubble } from '@/features/chat/ChatBubble';
import { ChatMessageRow } from '@/features/chat/ChatMessageRow';
import { layoutRows } from '@/features/chat/chatRows';
import { useChatStore } from '@/features/chat/chatStore';
import { LoadingBubble } from '@/features/chat/LoadingBubble';
import { useChatAutoScroll } from '@/features/chat/useChatAutoScroll';

/** 首条气泡顶部距滚动容器顶部：首条头像顶部（画布 243.42）换算到容器内，再加头像盒到气泡的偏移 */
const FIRST_BUBBLE_TOP = CHAT_ANCHOR.firstAvatarTop - CHAT_SCROLL.y + AVATAR.topToBubble;

/**
 * 内容尾部留白：原项目为"末尾装饰上下各 32 + 装饰高 26 + 尾部留白 100"，装饰只在已删除的导出模式显示，
 * 但空位保留，最后一条消息才不会被底部输入面板及其 60px 遮罩条盖住
 */
const TAIL_SPACE = 32 + 26 + 32 + CHAT_ANCHOR.bottomPad;

/** 未测量行的估计高度：单行气泡 49.32 + 跨方向间距 33，再为多行留些余量 */
const ESTIMATED_ROW = 96;

/** 插入更早的历史后，多长时间内（ms）新插入的行长高都补偿到滚动位置；气泡测量在插入后一两帧内完成 */
const INSERT_SETTLE = 1000;

/** 可视区上下各多渲染几行，快速滚动时不露白 */
const OVERSCAN = 6;

/** 顶部"加载更早历史"加载气泡在可视区顶部的位置（与首条气泡同一列）；外层 sticky 且高度为 0，出现和消失都不推动内容 */
const TOP_LOADING = {
  left: CHAT_ANCHOR.otherBubbleX - CHAT_SCROLL.x,
  top: (FIRST_BUBBLE_TOP - BUBBLE.singleLineH) / 2,
} as const;

/** MessageList 属性 */
export interface MessageListProps {
  conversationId: number;
  /** 已加载的持久化消息（最近一页加上已加载的更早历史） */
  messages: Message[];
  /** 角色头像 / 管理员头像 */
  otherAvatar: string;
  mineAvatar: string;
  /** 点击我方头像：切换管理员性别 */
  onMineAvatarClick: () => void;
}

/** 一行要显示的内容；text 为 null 表示加载气泡 */
interface RowItem {
  side: MessageSide;
  text: string | null;
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
  const hasMore = useChatStore((s) => s.hasMoreByConversation[conversationId] ?? false);
  const loadingEarlier = useChatStore((s) => s.loadingEarlierId === conversationId);
  const loadEarlierMessages = useChatStore((s) => s.loadEarlierMessages);

  // 只有当前会话就是流所属会话时才显示临时气泡与加载气泡
  const own = streaming !== null && streaming.conversationId === conversationId;
  const bubbles = own ? streaming.bubbles : [];
  const pending = own && streaming.pending;
  // 打字机正在写的是最后一个临时气泡
  const typingIndex = own && streaming.typing ? messages.length + bubbles.length - 1 : -1;

  const rows: RowItem[] = [
    ...messages.map((m) => ({
      side: m.side,
      text: m.text,
      avatar: m.side === 'mine' ? mineAvatar : otherAvatar,
    })),
    ...bubbles.map((text) => ({ side: 'other' as const, text, avatar: otherAvatar })),
  ];
  // 加载气泡也参与布局计算，取得它自己的头像显隐与间距
  if (pending) rows.push({ side: 'other', text: null, avatar: otherAvatar });
  // 头像显隐与间距按完整列表计算，虚拟列表只渲染其中一段也和不虚拟化时一致
  const layouts = layoutRows(rows);

  // ⚠️ 行编号以原点消息为 0：插入更早的历史得到负数，末尾追加得到更大的数；流结束后临时气泡原位换成持久化消息时
  // 编号不变，组件与测量结果沿用。编号 >= threshold 的行是挂载后追加的，才做加载→真实尺寸的过渡
  const [origin, setOrigin] = useState(() => ({
    id: messages[0]?.id ?? null,
    threshold: rows.length,
  }));
  const found = origin.id === null ? 0 : messages.findIndex((m) => m.id === origin.id);
  if (origin.id === null && messages.length > 0) {
    // 挂载时列表为空：第一条消息出现后以它为原点，此时它就在下标 0，现有编号不变
    setOrigin({ id: messages[0].id, threshold: origin.threshold });
  } else if (found === -1) {
    // 原点消息不在了（重新打开后只剩最新一页、清空消息、回复超过一页）：以当前第一条为新原点，现有的行都算已显示
    setOrigin({ id: messages[0]?.id ?? null, threshold: rows.length });
  }
  const originIndex = Math.max(found, 0);

  // 插入更早的历史：原来的第一条消息现在的下标（没有插入时为 null）
  const [firstId, setFirstId] = useState(messages[0]?.id ?? null);
  const [insertedAbove, setInsertedAbove] = useState<number | null>(null);
  if ((messages[0]?.id ?? null) !== firstId) {
    const oldIndex = firstId === null ? -1 : messages.findIndex((m) => m.id === firstId);
    setFirstId(messages[0]?.id ?? null);
    setInsertedAbove(oldIndex > 0 ? oldIndex : null);
  }

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useChatAutoScroll({
    conversationId,
    onReachTop:
      hasMore && !loadingEarlier ? () => void loadEarlierMessages(conversationId) : undefined,
  });

  // 项目没有启用 React Compiler，组件本来就不会被自动 memo；该规则只提示 useVirtualizer 返回的函数不能被记忆化
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => index - originIndex,
    estimateSize: () => ESTIMATED_ROW,
    // 画布有 CSS zoom：getBoundingClientRect 是缩放后的尺寸，scrollTop 却是设计 px；
    // 行高改用 ResizeObserver 的 borderBoxSize（未缩放、带小数），没有时退回 offsetHeight
    measureElement: (el, entry) =>
      entry?.borderBoxSize[0]?.blockSize ?? (el as HTMLElement).offsetHeight,
    overscan: OVERSCAN,
    paddingStart: FIRST_BUBBLE_TOP,
    paddingEnd: TAIL_SPACE,
    initialRect: { width: CHAT_SCROLL.w, height: CHAT_SCROLL.h },
    // 首次渲染就取末尾的行：会话打开时停在底部，不会先渲染顶部的行再换掉
    initialOffset: () => Number.MAX_SAFE_INTEGER,
    // 首尾行键变化（插入更早的历史）时，以当前滚动位置处的行为锚点、按行键在计算渲染范围之前修正滚动偏移，
    // 可见消息留在原位；追加到末尾不跟随（followOnAppend 默认关闭），跟随底部由 useChatAutoScroll 负责
    anchorTo: 'end',
  });
  const items = virtualizer.getVirtualItems();

  // 插入更早的历史后的一小段时间：记下原第一条消息的下标与截止时刻，供下面的补偿规则读取
  const settleRef = useRef<{ index: number; until: number } | null>(null);
  useLayoutEffect(() => {
    settleRef.current =
      insertedAbove === null
        ? null
        : { index: insertedAbove, until: performance.now() + INSERT_SETTLE };
  }, [insertedAbove, firstId]);

  // ⚠️ 行尺寸变化时是否补偿滚动位置：顶部在可视区上沿之上的行，第一次测量与之后长高（气泡测量完成）都补偿，
  // 可视区里的内容保持不动，等同浏览器的滚动锚定。库默认不补偿跨在上沿的行、判断用的起点也可能没计入同一批里
  // 前几行刚测出的变化。停在顶部留白里加载更早的历史时，新插入的行会露在可视区顶部，它们的气泡测量完成后长高
  // 会把原来的消息往下推，所以插入后的一小段时间里，原第一条消息上方的行无论是否可见都补偿。跟随底部时由库按末尾锚定
  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const settle = settleRef.current;
      if (settle !== null && item.index < settle.index && performance.now() < settle.until) {
        return true;
      }
      instance.getTotalSize();
      const start = instance.measurementsCache[item.index]?.start ?? item.start;
      return start < (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
    };
  }, [virtualizer]);

  // 我方发送（末尾出现乐观显示的临时消息）时滚到底部，即使用户正在向上浏览
  const lastMessage = messages.at(-1);
  const sentId = lastMessage !== undefined && lastMessage.id < 0 ? lastMessage.id : null;
  useEffect(() => {
    if (sentId !== null) scrollToBottom();
  }, [sentId, scrollToBottom]);

  // "有新消息"：暂停跟随后，最后一行（不算加载气泡）的编号变了，说明有新的消息行到达
  const lastKey = messages.length + bubbles.length - 1 - originIndex;
  const [pausedLastKey, setPausedLastKey] = useState<number | null>(null);
  if (!isAtBottom && pausedLastKey === null) setPausedLastKey(lastKey);
  if (isAtBottom && pausedLastKey !== null) setPausedLastKey(null);
  const hasNew = pausedLastKey !== null && lastKey !== pausedLastKey;

  return (
    <>
      <div
        ref={scrollRef}
        role="log"
        aria-label="消息列表"
        aria-live="off"
        className="absolute z-[3] animate-chat-in [scrollbar-width:thin] [scrollbar-color:var(--color-scrollbar-chat)_transparent] overflow-x-hidden overflow-y-auto scroll-mask [--mask-bottom-in:calc(100%_-_80px)] [--mask-bottom-out:calc(100%_-_40px)] [--mask-right:14px] [--mask-top-in:20px] [--mask-top-out:40px] [overflow-anchor:none]"
        style={boxStyle(CHAT_SCROLL)}
      >
        {/* 加载更早历史时的加载气泡：粘在可视区顶部，高度为 0 不占布局；放在内容里的固定位置会在触发加载时已滚出可视区 */}
        {loadingEarlier && (
          <div className="sticky top-0 z-[1] h-0">
            <div className="absolute" style={TOP_LOADING}>
              <LoadingBubble side="other" />
            </div>
          </div>
        )}
        {/* 内容固定为容器设计宽，滚动条出现时不改变行内坐标；高度是全部行（含未渲染行的估计值）之和 */}
        <div
          ref={contentRef}
          className="relative w-[1312px]"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {/* 渲染的行按正常文档流排在一个整体平移的容器里，相邻行的间距与不虚拟化时逐像素一致 */}
          {/* ⚠️ 与下一行的间距放在本行的 paddingBottom：插入更早的历史时已有的行尺寸不变（放在 paddingTop 的话，
              原来的第一行会因为上方多了一行而在顶部长高，可见内容被推下去）；测量尺寸包含 padding、不含 margin */}
          <div
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}
          >
            {items.map((item) => {
              const row = rows[item.index];
              const layout = layouts[item.index];
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ paddingBottom: layouts[item.index + 1]?.gap ?? 0 }}
                >
                  <ChatMessageRow
                    side={row.side}
                    avatar={row.avatar}
                    showAvatar={layout.showAvatar}
                    onAvatarClick={onMineAvatarClick}
                  >
                    {row.text === null ? (
                      <LoadingBubble side="other" />
                    ) : (
                      <ChatBubble
                        side={row.side}
                        text={row.text}
                        animate={Number(item.key) >= origin.threshold}
                        typing={item.index === typingIndex}
                      />
                    )}
                  </ChatMessageRow>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!isAtBottom && <BackToBottomButton hasNew={hasNew} onClick={() => scrollToBottom(true)} />}
    </>
  );
}
