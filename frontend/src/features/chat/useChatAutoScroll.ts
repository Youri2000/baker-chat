/**
 * @file useChatAutoScroll：聊天消息区的全部滚动规则，MessageList 只负责渲染消息和回到底部按钮。
 * - 打开会话、调用 scrollToBottom（我方发送、点击按钮）时滚到底部并跟随；
 * - 跟随时内容尺寸变化（新行、流式气泡、加载气泡、气泡测量完成）保持在底部；
 * - 只有用户向上滚动、离开底部超过 NEAR_BOTTOM 才暂停跟随，程序自己滚动或内容变高不会误判；
 * - 用户滚回距底部 NEAR_BOTTOM 以内恢复跟随；滚到距顶部 NEAR_TOP 以内时通知加载更早的历史；
 * - 卸载时断开 ResizeObserver、移除滚动监听。
 * 插入更早的历史后保持可见消息不动由虚拟列表负责（MessageList 的 anchorTo）：它在计算渲染范围之前就按行键修正滚动偏移，
 * 这里在提交之后再补偿会晚一步，新插入的行已按旧偏移渲染和测量。
 * 滚动距离都是设计 px：画布用 CSS zoom 缩放，Chromium 下 scrollTop / scrollHeight 不受 zoom 影响。
 * 💡 "只有向上滚动离开底部才暂停"而不是只看距底距离：程序滚动与内容变高不会让 scrollTop 变小，详见 docs/interview.md#auto-scroll
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** 距离底部多少以内算"接近底部"：约一条单行消息（气泡 49.32 + 跨方向间距 33） */
const NEAR_BOTTOM = 80;

/** 距离顶部多少以内触发加载更早的历史 */
const NEAR_TOP = 200;

/** useChatAutoScroll 参数 */
export interface ChatAutoScrollOptions {
  /** 当前会话；变化时滚到底部并恢复跟随 */
  conversationId: number;
  /** 滚动到距顶部 NEAR_TOP 以内时调用，用来加载更早的历史 */
  onReachTop?: () => void;
}

/** useChatAutoScroll 返回值 */
export interface ChatAutoScroll {
  /** 滚动容器 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 滚动内容；观察它的尺寸变化 */
  contentRef: RefObject<HTMLDivElement | null>;
  /** 是否在跟随底部；false 时显示回到底部按钮 */
  isAtBottom: boolean;
  /** 滚到底部并恢复跟随；smooth 为 true 时平滑滚动（点击按钮），否则瞬时 */
  scrollToBottom: (smooth?: boolean) => void;
}

/** ✅ 聊天消息区的自动滚动 */
export function useChatAutoScroll({
  conversationId,
  onReachTop,
}: ChatAutoScrollOptions): ChatAutoScroll {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // 以下几项放 ref：ResizeObserver 与滚动回调读最新值，监听不随渲染重建
  const followingRef = useRef(true);
  /** 上一次看到的 scrollTop，用来判断这次滚动是不是向上 */
  const lastTopRef = useRef(0);
  const onReachTopRef = useRef(onReachTop);

  useEffect(() => {
    onReachTopRef.current = onReachTop;
  }, [onReachTop]);

  /** 同时更新跟随状态的 ref 与按钮显隐 */
  const setFollowing = useCallback((following: boolean) => {
    followingRef.current = following;
    setIsAtBottom(following);
  }, []);

  /** 滚到底部并恢复跟随；smooth 为 true 时平滑滚动（点击按钮），否则瞬时 */
  const scrollToBottom = useCallback(
    (smooth = false) => {
      const el = scrollRef.current;
      if (el === null) return;
      setFollowing(true);
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
    },
    [setFollowing],
  );

  // 打开（切换到）会话：在绘制前滚到底部，首屏不会先闪现顶部
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
    followingRef.current = true;
  }, [conversationId]);

  // 内容尺寸变化：跟随时保持在底部；暂停时若内容缩短到接近底部（如清空消息），恢复跟随
  useEffect(() => {
    const el = scrollRef.current!;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) {
        el.scrollTop = el.scrollHeight;
      } else if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM) {
        setFollowing(true);
      }
      lastTopRef.current = el.scrollTop;
    });
    observer.observe(contentRef.current!);
    return () => observer.disconnect();
  }, [setFollowing]);

  // 滚动：只有向上滚动离开底部才暂停跟随；回到底部附近恢复跟随；靠近顶部通知加载更早的历史
  useEffect(() => {
    const el = scrollRef.current!;
    /** 滚动回调 */
    function handleScroll() {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance <= NEAR_BOTTOM) {
        if (!followingRef.current) setFollowing(true);
      } else if (el.scrollTop < lastTopRef.current && followingRef.current) {
        setFollowing(false);
      }
      lastTopRef.current = el.scrollTop;
      if (el.scrollTop <= NEAR_TOP) onReachTopRef.current?.();
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [setFollowing]);

  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
