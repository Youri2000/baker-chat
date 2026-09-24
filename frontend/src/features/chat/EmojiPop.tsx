/**
 * @file 表情弹层：紧贴输入面板顶边向上展开、与面板同宽，16 列 60px 格、间距 16 的网格列出 37 个表情。
 * 由 ChatInput 在展开时渲染并传入根元素 ref（用于判断"弹层以外的 pointerdown"）；点击表情回调 onPick。
 */
import type { MouseEvent, RefObject } from 'react';
import { EMOJI_POP, PANEL } from '@/constants/design';
import { EMOJIS, type Emoji } from '@/constants/emoji';
import { MATERIALS } from '@/constants/materials';

/** 行数与弹层高度：上下内边距 + 行×格高 + 行间距，正好放下全部表情不出滚动条 */
const ROWS = Math.ceil(EMOJIS.length / EMOJI_POP.cols);
const POP_H = EMOJI_POP.pad * 2 + ROWS * EMOJI_POP.cell + (ROWS - 1) * EMOJI_POP.gap;

/** EmojiPop 属性 */
export interface EmojiPopProps {
  ref: RefObject<HTMLDivElement | null>;
  onPick: (emoji: Emoji) => void;
}

/** 按下表情格时不让输入框失焦，插入位置才是用户放置的光标 */
function keepInputFocus(event: MouseEvent) {
  event.preventDefault();
}

/** 表情弹层 */
export function EmojiPop({ ref, onPick }: EmojiPopProps) {
  return (
    <div
      ref={ref}
      className="absolute left-0 z-[11] origin-bottom animate-pop-up overflow-hidden rounded-t-panel bg-emoji-pop"
      style={{ top: -POP_H, width: PANEL.w, height: POP_H }}
    >
      <img
        className="pointer-events-none absolute top-0 left-0 select-none"
        src={MATERIALS.editPopDecoTl}
        alt=""
      />
      <img
        className="pointer-events-none absolute right-0 bottom-0 select-none"
        src={MATERIALS.editPopDecoBr}
        alt=""
      />
      <div
        className="pointer-events-auto absolute inset-0 grid [scrollbar-width:thin] [scrollbar-color:var(--color-scrollbar-chat)_transparent] content-start justify-center overflow-x-hidden overflow-y-auto"
        style={{
          padding: EMOJI_POP.pad,
          gap: EMOJI_POP.gap,
          gridTemplateColumns: `repeat(${EMOJI_POP.cols}, ${EMOJI_POP.cell}px)`,
        }}
      >
        {EMOJIS.map((emoji) => (
          <button
            key={emoji.token}
            type="button"
            aria-label={emoji.token}
            className="relative cursor-pointer rounded-[8px] ease-default after:absolute after:inset-0 after:rounded-[8px] after:bg-hover-overlay after:opacity-0 after:transition-opacity after:duration-150 after:content-[''] hover:after:opacity-100"
            style={{ width: EMOJI_POP.cell, height: EMOJI_POP.cell }}
            onMouseDown={keepInputFocus}
            onClick={() => onPick(emoji)}
          >
            <img className="block h-full w-full object-contain" src={emoji.src} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
