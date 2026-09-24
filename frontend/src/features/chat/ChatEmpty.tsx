/**
 * @file 聊天区空态（未选中会话）：自上而下渐隐的遮罩与浅色叠加、占位图、10×10 点阵 SVG、"- 请选择会话 -"提示。
 * 区域顶端对齐第一张主卡、底边与聊天框底边相同（constants/design 的 CHAT_EMPTY）；由 ChatArea 渲染。
 */
import { CHAT_EMPTY } from '@/constants/design';
import { MATERIALS } from '@/constants/materials';
import { boxStyle } from '@/features/chat/boxStyle';

/** 空态区域矩形 */
const EMPTY_BOX = {
  x: CHAT_EMPTY.x,
  y: CHAT_EMPTY.top,
  w: CHAT_EMPTY.w,
  h: CHAT_EMPTY.bottom - CHAT_EMPTY.top,
};

/** 10×10 点阵的 100 个格子 */
const DOTS = Array.from({ length: 100 }, (_, i) => i);

/** 空态 */
export function ChatEmpty() {
  const box = boxStyle(EMPTY_BOX);
  return (
    <>
      {/* 遮罩（z2）与浅色叠加：都从 5% 白渐隐到透明 */}
      <div
        className="pointer-events-none absolute z-[2] bg-linear-to-b from-chat-tint to-transparent"
        style={box}
      />
      <div
        className="pointer-events-none absolute bg-linear-to-b from-chat-tint to-transparent"
        style={box}
      />
      {/* ⚠️ 零尺寸容器内的 img 必须 max-w-none：preflight 的 max-width:100% 会把宽度压成 0 */}
      <img
        className="pointer-events-none absolute z-[2] max-w-none object-none object-top"
        style={box}
        src={MATERIALS.chatEmptyPlaceholder}
        alt=""
      />
      {/* 点阵与提示文字同一偏移（下移 30px、左移 25px）居中 */}
      <div
        className="pointer-events-none absolute z-[1] flex -translate-x-[25px] items-center justify-center pt-[30px]"
        style={box}
      >
        <svg width={CHAT_EMPTY.dotsSize} height={CHAT_EMPTY.dotsSize} viewBox="0 0 10 10">
          {DOTS.map((i) => (
            <circle
              key={i}
              cx={(i % 10) + 0.5}
              cy={Math.floor(i / 10) + 0.5}
              r={0.08}
              fill="rgba(255, 255, 255, 0.2)"
            />
          ))}
        </svg>
      </div>
      <p
        className="pointer-events-none absolute z-[3] flex -translate-x-[25px] items-center justify-center pt-[30px] font-bubble text-[22px] tracking-[2px]"
        style={box}
      >
        <span className="text-text-primary">-</span>
        <span className="text-white/70">请选择会话</span>
        <span className="text-text-primary">-</span>
      </p>
    </>
  );
}
