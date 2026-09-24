/**
 * @file 文字气泡：SVG 圆角矩形 + 尾巴，文字放在 foreignObject 里排版；表情 token 渲染成 inline 图片。
 * 气泡尺寸不再用 canvas 估算，而是用 ResizeObserver 读取文字块的实际渲染尺寸再加内边距得出，
 * 字体晚到（font-display: swap）时也会自动重新测量。
 * 💡 新追加的气泡先按加载气泡尺寸画一帧，测量结果到达后再过渡到真实尺寸，详见 docs/interview.md#bubble-measure
 */
import clsx from 'clsx';
import { memo, useEffect, useRef, useState } from 'react';
import { BUBBLE } from '@/constants/design';
import { splitEmojiText } from '@/constants/emoji';
import type { MessageSide } from '@/features/chat/api';
import { bubbleSvgWidth, tailTransform } from '@/features/chat/bubbleSvg';

/** ChatBubble 属性 */
export interface ChatBubbleProps {
  side: MessageSide;
  /** 消息文本，可含 \n 与表情 token */
  text: string;
  /** 列表挂载后追加的气泡：从加载气泡尺寸过渡到真实尺寸并淡入文字；首屏气泡直接按真实尺寸显示 */
  animate: boolean;
}

/** 文字块的实际渲染尺寸 */
interface InnerSize {
  w: number;
  h: number;
}

/** 文字气泡；props 全是原始值，memo 让流式追加新行时已有气泡不重渲染 */
export const ChatBubble = memo(function ChatBubble({ side, text, animate }: ChatBubbleProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState<InnerSize | null>(null);

  // ✅ 观察文字块尺寸：首次布局后与每次回流（字体加载、文本变化）都会回调
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setInner({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(textRef.current!);
    return () => observer.disconnect();
  }, []);

  // ⚠️ 未测量时用加载气泡尺寸：ResizeObserver 回调在首帧绘制之后才触发 React 更新，
  // 追加的气泡因此能从 100×单行高平滑过渡到真实尺寸
  const rectW = inner === null ? BUBBLE.loadingW : Math.max(BUBBLE.minW, inner.w + BUBBLE.padX * 2);
  const rectH =
    inner === null ? BUBBLE.singleLineH : Math.max(BUBBLE.minH, inner.h + BUBBLE.padY * 2);
  const svgW = bubbleSvgWidth(rectW, side);
  const fill = side === 'mine' ? 'fill-bubble-mine' : 'fill-bubble-other';
  const transition = animate && 'ease-out duration-(--anim-bubble)';

  return (
    <svg
      className={clsx(
        'block shrink-0 drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)]',
        transition && 'transition-[width,height]',
        transition,
        // 首屏气泡测量前不可见，避免以加载尺寸闪现一帧
        !animate && inner === null && 'invisible',
      )}
      style={{ width: svgW, height: rectH }}
    >
      <rect
        className={clsx(fill, transition && 'transition-[width,height]', transition)}
        x={BUBBLE.tailOffset}
        y={0}
        rx={BUBBLE.radius}
        ry={BUBBLE.radius}
        style={{ width: rectW, height: rectH }}
      />
      <path
        className={clsx(fill, transition && 'transition-transform', transition)}
        d={BUBBLE.tailPath}
        style={{
          transform: tailTransform(side, svgW),
          transformBox: 'view-box',
          transformOrigin: '0 0',
        }}
      />
      {/* 内文区从 rect 左内边距开始，宽度给到最大内宽让文字按 634 换行；高度由外层 svg 裁切 */}
      <foreignObject
        x={BUBBLE.tailOffset + BUBBLE.padX}
        y={BUBBLE.padY}
        width={BUBBLE.innerMaxW}
        height="100%"
      >
        <div
          ref={textRef}
          className={clsx(
            'block w-fit max-w-[634px] font-bubble text-bubble [word-break:break-word] whitespace-pre-line select-text',
            side === 'mine' ? 'text-bubble-text-mine' : 'text-bubble-text-other',
            // 过渡过半（50ms 延迟）后文字用 50ms 淡入
            animate && 'transition-opacity delay-[50ms] duration-[50ms]',
            animate && inner === null ? 'opacity-0' : 'opacity-100',
          )}
        >
          {splitEmojiText(text).map((part, i) =>
            typeof part === 'string' ? (
              part
            ) : (
              <img
                key={i}
                className="inline-block h-[1em] object-contain align-middle"
                style={{ width: `${part.aspect}em` }}
                src={part.src}
                alt=""
              />
            ),
          )}
        </div>
      </foreignObject>
    </svg>
  );
});
