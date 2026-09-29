/**
 * @file 底部输入面板：面板上方渐隐遮罩条 + 面板壳（顶部装饰图）+ contenteditable 胶囊输入框 + 表情 / 发送（停止）圆形按钮
 * + 表情弹层。键盘、粘贴、光标与表情插入、DOM 转文本等编辑行为都在 useChatComposer，本组件只负责布局、
 * 弹层开合与停止按钮；发送交给 chatStore.sendMessage（带上用户的打字机开关），流式期间禁用输入并把发送按钮换成停止。
 */
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { PANEL } from '@/constants/design';
import { MATERIALS } from '@/constants/materials';
import { useChatStore } from '@/features/chat/chatStore';
import { EmojiPop } from '@/features/chat/EmojiPop';
import { useChatComposer } from '@/features/chat/useChatComposer';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 45px 圆形按钮：hover 叠 20% 黑；禁用半透明 */
const CIRCLE_BUTTON =
  'bg-btn-bg after:bg-hover-overlay-gray ease-default pointer-events-auto relative h-[45px] w-[45px] cursor-pointer rounded-full after:absolute after:inset-0 after:rounded-full after:opacity-0 after:transition-opacity after:duration-150 after:content-[""] hover:after:opacity-100 disabled:pointer-events-none disabled:cursor-default disabled:opacity-50';

/** 按钮图标：留 8px 边距等比铺满，白色图标压暗 */
const BUTTON_ICON =
  'pointer-events-none absolute inset-[8px] h-[29px] w-[29px] object-contain brightness-[0.267] select-none';

/** 输入面板 */
export function ChatInput() {
  // 只订阅"是否有回复在进行"：打字机逐字更新 streaming 时输入面板不跟着重渲染
  const replying = useChatStore((s) => s.streaming !== null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  // 设置还没加载时按默认值开启
  const typewriter = useSettingsStore((s) => s.settings?.typewriter ?? true);
  const popRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [popOpen, setPopOpen] = useState(false);

  // 同一时刻只允许一条回复在进行：任何会话在流式回复时都禁用输入
  const disabled = replying;
  const { inputRef, handleKeyDown, handlePaste, insertEmoji, submit, keepInputFocus } =
    useChatComposer({ onSend: (text) => sendMessage(text, typewriter), disabled });

  // 弹层展开时，按下弹层与表情按钮以外的任何位置都收起（pointerdown 先于 click，按钮自身的点击照常执行）
  useEffect(() => {
    if (!popOpen) return;
    /** 判断按下位置 */
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popRef.current!.contains(target) || emojiButtonRef.current!.contains(target)) return;
      setPopOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [popOpen]);

  return (
    <>
      {/* 面板上方遮罩条：与面板同色，顶部 0–51px 渐入，消息滚到面板附近时先渐隐 */}
      <div
        className="pointer-events-none absolute z-[4] bg-panel-bg scroll-mask select-none [--mask-bottom-in:100%] [--mask-bottom-out:100%] [--mask-right:0px] [--mask-top-in:0px] [--mask-top-out:51px]"
        style={{
          left: PANEL.x,
          top: PANEL.y - PANEL.edgeMaskH,
          width: PANEL.w,
          height: PANEL.edgeMaskH,
        }}
      />
      {/* 面板本体不拦截事件（滚轮可穿透到消息区），只有输入框、按钮和弹层网格接收事件 */}
      <div
        className="pointer-events-none absolute z-[10] flex items-center rounded-b-panel bg-panel-bg"
        style={{
          left: PANEL.x,
          top: PANEL.y,
          width: PANEL.w,
          height: PANEL.h,
          paddingLeft: PANEL.padX,
          paddingRight: PANEL.padX,
          gap: PANEL.gap,
        }}
      >
        <img
          className="pointer-events-none absolute select-none"
          style={{
            left: (PANEL.w - PANEL.topDecoW) / 2,
            top: -PANEL.topDecoH - PANEL.topDecoGap,
            width: PANEL.topDecoW,
            height: PANEL.topDecoH,
          }}
          src={MATERIALS.choiceTopDeco}
          alt=""
        />
        {/* 💡 contenteditable 而非 textarea：文字中间要显示表情图片；换行、粘贴、表情插入与序列化成 [sns_emoji_NNN] token
            的编辑规则都在 useChatComposer，详见 docs/interview.md#contenteditable-emoji */}
        <div
          ref={inputRef}
          role="textbox"
          aria-multiline="true"
          aria-label="发消息输入框"
          contentEditable={!disabled}
          data-placeholder="发消息"
          data-disabled={disabled || undefined}
          className="pointer-events-auto h-[45px] min-w-0 flex-1 [scrollbar-width:none] overflow-x-hidden overflow-y-auto rounded-full bg-btn-bg px-[24px] py-[8px] font-bubble text-bubble leading-[1.4] [word-break:break-word] whitespace-pre-wrap text-input-text outline-none select-text before:pointer-events-none before:text-[rgba(42,42,42,0.5)] before:select-none empty:before:content-[attr(data-placeholder)] data-disabled:pointer-events-none data-disabled:opacity-50"
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="pointer-events-none flex items-center" style={{ gap: PANEL.gap }}>
          <button
            ref={emojiButtonRef}
            type="button"
            aria-label="表情"
            className={CIRCLE_BUTTON}
            disabled={disabled}
            onMouseDown={keepInputFocus}
            onClick={() => setPopOpen((open) => !open)}
          >
            <img className={BUTTON_ICON} src={MATERIALS.editBtnEmoticon} alt="" />
          </button>
          {disabled ? (
            <button
              type="button"
              aria-label="停止"
              className={clsx(CIRCLE_BUTTON, 'bg-stop after:bg-[rgba(0,0,0,0.15)]')}
              onClick={() => void stopGeneration()}
            >
              <span className="absolute top-1/2 left-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-white" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送"
              className={CIRCLE_BUTTON}
              onMouseDown={keepInputFocus}
              onClick={submit}
            >
              <img className={BUTTON_ICON} src={MATERIALS.editBtnChat} alt="" />
            </button>
          )}
        </div>
        {popOpen && <EmojiPop ref={popRef} onPick={insertEmoji} />}
      </div>
    </>
  );
}
