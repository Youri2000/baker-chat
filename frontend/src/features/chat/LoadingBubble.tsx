/**
 * @file 加载气泡：与 ChatBubble 同一套 SVG 范式（rect + 尾巴 + foreignObject），内文为三个闪烁方块。
 * 出现时 rect 与方块用 clip-path 从 0 展开到 100px：几何宽度始终是 100，圆角不会被 SVG 钳制成直角。
 * 只在 chatStore.streaming.pending 且当前会话就是流所属会话时由 MessageList 渲染。
 */
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { BUBBLE } from '@/constants/design';
import type { MessageSide } from '@/features/chat/api';
import { bubbleSvgWidth, tailTransform } from '@/features/chat/bubbleSvg';

/** LoadingBubble 属性 */
export interface LoadingBubbleProps {
  /** 朝向：决定尾巴方向、配色与展开方向 */
  side: MessageSide;
}

/** 三个方块的闪烁延迟（s），错开 0.2s */
const DOT_DELAYS = [0, 0.2, 0.4];

/** 加载气泡 */
export function LoadingBubble({ side }: LoadingBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  // ⚠️ CSS transition 只在属性值变化时触发：先让浏览器画出"全裁"状态，再切到"全显示"，所以要等两帧
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  const svgW = bubbleSvgWidth(BUBBLE.loadingW, side);
  const hidden = expanded ? 0 : BUBBLE.loadingW;
  // 对方侧裁右边从左往右展开；我方侧裁左边从右往左展开
  const clipPath = side === 'other' ? `inset(0 ${hidden}px 0 0)` : `inset(0 0 0 ${hidden}px)`;
  const fill = side === 'mine' ? 'fill-bubble-mine' : 'fill-bubble-other';

  return (
    <svg
      role="status"
      aria-label="正在回复"
      className="block shrink-0 drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)]"
      width={svgW}
      height={BUBBLE.singleLineH}
    >
      <rect
        className={clsx('transition-[clip-path] duration-(--anim-bubble) ease-out', fill)}
        x={BUBBLE.tailOffset}
        y={0}
        width={BUBBLE.loadingW}
        height={BUBBLE.singleLineH}
        rx={BUBBLE.radius}
        ry={BUBBLE.radius}
        style={{ clipPath }}
      />
      <path
        className={fill}
        d={BUBBLE.tailPath}
        style={{
          transform: tailTransform(side, svgW),
          transformBox: 'view-box',
          transformOrigin: '0 0',
        }}
      />
      <foreignObject
        x={BUBBLE.tailOffset}
        y={0}
        width={BUBBLE.loadingW}
        height={BUBBLE.singleLineH}
      >
        {/* 方块与 rect 同步裁剪，展开前不会漂在矩形外 */}
        <div
          className={clsx(
            'flex h-full w-full items-center justify-center transition-[clip-path] duration-(--anim-bubble) ease-out',
            side === 'mine' ? 'text-loading-dot-mine' : 'text-loading-dot-other',
          )}
          style={{ clipPath, gap: BUBBLE.loadingDotGap }}
        >
          {DOT_DELAYS.map((delay) => (
            <span
              key={delay}
              className="block animate-loading-dot bg-current"
              style={{
                width: BUBBLE.loadingDot,
                height: BUBBLE.loadingDot,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </div>
      </foreignObject>
    </svg>
  );
}
