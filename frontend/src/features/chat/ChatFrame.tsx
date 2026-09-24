/**
 * @file 聊天框（CSS 绘制，替代原 chat_strip_detail.png）：1.5px 左右下框线、顶部线右侧缺口、
 * 缺口内的 SVG 凹口、品红/黄/青三色发光条。几何来自 constants/design 的 CHAT_FRAME_BOX / CHAT_FRAME，
 * 只在选中会话时由 ChatArea 渲染。
 */
import { CHAT_FRAME, CHAT_FRAME_BOX } from '@/constants/design';
import { boxStyle } from '@/features/chat/boxStyle';

/** 聊天框：高于滚动内容(z3)与底部装饰(z4)，低于输入面板(z10)，不拦截事件 */
export function ChatFrame() {
  const bar = { width: CHAT_FRAME.barW, height: CHAT_FRAME.barH };
  return (
    <div className="pointer-events-none absolute z-[5]" style={boxStyle(CHAT_FRAME_BOX)}>
      {/* 左 / 右 / 下三边框线，底部两角圆角 */}
      <div
        className="absolute inset-0 rounded-b-frame border-solid border-chat-frame"
        style={{
          borderLeftWidth: CHAT_FRAME.line,
          borderRightWidth: CHAT_FRAME.line,
          borderBottomWidth: CHAT_FRAME.line,
        }}
      />
      {/* 顶部左段线：右侧留出缺口 */}
      <div
        className="absolute top-0 left-0 bg-chat-frame"
        style={{ right: CHAT_FRAME.gap, height: CHAT_FRAME.line }}
      />
      {/* 顶部右端小段 */}
      <div
        className="absolute top-0 right-0 bg-chat-frame"
        style={{ width: CHAT_FRAME.segW, height: CHAT_FRAME.line }}
      />
      {/* SVG 凹口：缺口中一条中间下沉的折线，上移悬于框顶线上方 */}
      <div
        className="absolute"
        style={{
          top: -CHAT_FRAME.notchLift,
          right: CHAT_FRAME.segW,
          width: CHAT_FRAME.notchW,
          height: CHAT_FRAME.notchH,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${CHAT_FRAME.notchW} ${CHAT_FRAME.notchH}`}
          preserveAspectRatio="none"
        >
          <path
            d={CHAT_FRAME.notchPath}
            fill="none"
            stroke="var(--color-chat-frame)"
            strokeWidth={CHAT_FRAME.line}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {/* 三色发光条：品红 / 黄 / 青，两端斜切 */}
      <div
        className="absolute top-0 flex"
        style={{ right: CHAT_FRAME.barsRight, height: CHAT_FRAME.barH, gap: CHAT_FRAME.barGap }}
      >
        <span
          className="block shrink-0 bg-chat-bar-magenta shadow-[0_0_8px_var(--color-chat-bar-magenta)] [clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]"
          style={bar}
        />
        <span
          className="block shrink-0 bg-chat-bar-yellow shadow-[0_0_8px_var(--color-chat-bar-yellow)]"
          style={bar}
        />
        <span
          className="block shrink-0 bg-chat-bar-cyan shadow-[0_0_8px_var(--color-chat-bar-cyan)] [clip-path:polygon(0_0,100%_0,calc(100%_-_8px)_100%,0_100%)]"
          style={bar}
        />
      </div>
    </div>
  );
}
