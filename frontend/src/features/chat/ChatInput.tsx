/**
 * @file 底部输入面板：面板上方渐隐遮罩条 + 面板壳（顶部装饰图）+ contenteditable 胶囊输入框 + 表情 / 发送（停止）圆形按钮
 * + 表情弹层。Enter 发送、Ctrl/Shift/Cmd+Enter 换行、粘贴只取纯文本；发送时用 emojiHtml 把内容序列化成含 token 的文本，
 * 交给 chatStore.sendMessage；流式期间禁用输入并把发送按钮换成停止。
 */
import clsx from 'clsx';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { PANEL } from '@/constants/design';
import { type Emoji } from '@/constants/emoji';
import { MATERIALS } from '@/constants/materials';
import { useChatStore } from '@/features/chat/chatStore';
import { EmojiPop } from '@/features/chat/EmojiPop';
import { emojiToHtml, htmlToEmojiText } from '@/features/chat/emojiHtml';

/** 45px 圆形按钮：hover 叠 20% 黑；禁用半透明 */
const CIRCLE_BUTTON =
  'bg-btn-bg after:bg-hover-overlay-gray ease-default pointer-events-auto relative h-[45px] w-[45px] cursor-pointer rounded-full after:absolute after:inset-0 after:rounded-full after:opacity-0 after:transition-opacity after:duration-150 after:content-[""] hover:after:opacity-100 disabled:pointer-events-none disabled:cursor-default disabled:opacity-50';

/** 按钮图标：留 8px 边距等比铺满，白色图标压暗 */
const BUTTON_ICON =
  'pointer-events-none absolute inset-[8px] h-[29px] w-[29px] object-contain brightness-[0.267] select-none';

/** 按下按钮时不让输入框失焦（表情插入位置、连续输入都依赖它） */
function keepInputFocus(event: MouseEvent) {
  event.preventDefault();
}

/** 输入面板 */
export function ChatInput() {
  const streaming = useChatStore((s) => s.streaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const inputRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [popOpen, setPopOpen] = useState(false);

  // 同一时刻只允许一条回复在进行：任何会话在流式回复时都禁用输入
  const disabled = streaming !== null;

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

  /** 序列化输入框内容并发送；空白不发送 */
  function handleSend() {
    const input = inputRef.current!;
    const text = htmlToEmojiText(input).trim();
    if (text === '') return;
    input.innerHTML = '';
    void sendMessage(text);
  }

  /** Enter 发送；带 Shift / Ctrl / Cmd 时插入换行（execCommand 保留原生撤销栈） */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // ⚠️ 中文输入法选词阶段的 Enter 只是确认候选，不能发送
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      document.execCommand('insertText', false, '\n');
      return;
    }
    handleSend();
  }

  /** 粘贴只保留纯文本 */
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  }

  /** ✅ 在光标处插入表情：光标在输入框内则替换选区，否则追加到末尾；之后光标停在表情后面 */
  function handlePickEmoji(emoji: Emoji) {
    const input = inputRef.current!;
    input.focus();
    const fragment = document.createRange().createContextualFragment(emojiToHtml(emoji.token));
    const selection = window.getSelection();
    if (selection !== null && selection.rangeCount > 0 && input.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(fragment);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    input.append(fragment);
  }

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
              onClick={handleSend}
            >
              <img className={BUTTON_ICON} src={MATERIALS.editBtnChat} alt="" />
            </button>
          )}
        </div>
        {popOpen && <EmojiPop ref={popRef} onPick={handlePickEmoji} />}
      </div>
    </>
  );
}
