/**
 * @file 输入框编辑行为 Hook：Enter 发送、Shift/Ctrl/Cmd/Alt+Enter 换行、输入法选词保护、粘贴只取纯文本、
 * 按下按钮时保住输入框焦点与光标、在光标处插入表情；发送时用 emojiHtml 把 contenteditable 内容序列化成
 * 含 [sns_emoji_NNN] token 的文本交给 onSend，并清空输入框。由 ChatInput 调用，onSend 为 chatStore.sendMessage，
 * disabled 为"有回复正在流式进行"；禁用时 submit 与 insertEmoji 不生效。
 */
import {
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { type Emoji } from '@/constants/emoji';
import { emojiToHtml, htmlToEmojiText } from '@/features/chat/emojiHtml';

/** useChatComposer 参数 */
export interface ChatComposerOptions {
  /** 收到序列化后的非空文本；返回的 Promise 不等待（发送失败由 chatStore 自行提示） */
  onSend: (text: string) => Promise<void>;
  /** 流式回复期间为 true：submit 与 insertEmoji 不生效 */
  disabled: boolean;
}

/** useChatComposer 返回值 */
export interface ChatComposer {
  /** 绑到 contenteditable 输入框 */
  inputRef: RefObject<HTMLDivElement | null>;
  /** 输入框的 onKeyDown：Enter 发送，带修饰键换行，输入法选词时不处理 */
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** 输入框的 onPaste：只插入纯文本 */
  handlePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  /** 表情弹层的 onPick：在光标处插入表情；禁用时不生效 */
  insertEmoji: (emoji: Emoji) => void;
  /** 发送按钮的 onClick，Enter 也走它；禁用或空白时不发送 */
  submit: () => void;
  /** 表情按钮、发送按钮的 onMouseDown：按下按钮时输入框不失焦，光标留在原处 */
  keepInputFocus: (event: MouseEvent) => void;
}

/** 按下按钮时不让输入框失焦（表情插入位置、连续输入都依赖它） */
function keepInputFocus(event: MouseEvent) {
  event.preventDefault();
}

/**
 * 输入框编辑行为。返回值：
 * - inputRef：绑到 contenteditable 输入框；
 * - handleKeyDown / handlePaste：输入框的 onKeyDown / onPaste；
 * - insertEmoji：表情弹层的 onPick；
 * - submit：发送按钮的 onClick，Enter 也走它；
 * - keepInputFocus：表情按钮、发送按钮的 onMouseDown。按下按钮时输入框不失焦，浏览器选区（光标）就留在原处，
 *   insertEmoji 才能插到用户放置的位置；ChatInput 的两个按钮都需要它，所以一并返回。
 */
export function useChatComposer({ onSend, disabled }: ChatComposerOptions): ChatComposer {
  const inputRef = useRef<HTMLDivElement>(null);

  /** 序列化输入框内容并发送；禁用或空白时不发送 */
  function submit() {
    if (disabled) return;
    const input = inputRef.current!;
    const text = htmlToEmojiText(input).trim();
    if (text === '') return;
    input.innerHTML = '';
    void onSend(text);
  }

  /** Enter 发送；带 Shift / Ctrl / Cmd / Alt 时插入换行（execCommand 保留原生撤销栈） */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // ⚠️ 中文输入法选词阶段的 Enter 只是确认候选，不能发送
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      document.execCommand('insertText', false, '\n');
      return;
    }
    submit();
  }

  /** 粘贴只保留纯文本 */
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  }

  /** ✅ 在光标处插入表情：光标在输入框内则替换选区，否则插到内容末尾；之后光标停在表情后面 */
  function insertEmoji(emoji: Emoji) {
    // ⚠️ 回复期间表情弹层可能仍开着，点表情不能插进禁用的输入框
    if (disabled) return;
    const input = inputRef.current!;
    const selection = window.getSelection()!;
    // ⚠️ 先判断选区再 focus()：输入框失焦后 Chrome 的 focus() 会把光标放到开头，此时应把光标移到末尾
    const outside = !input.contains(selection.anchorNode);
    input.focus();
    if (outside) {
      selection.selectAllChildren(input);
      selection.collapseToEnd();
    }
    const fragment = document.createRange().createContextualFragment(emojiToHtml(emoji.token));
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return { inputRef, handleKeyDown, handlePaste, insertEmoji, submit, keepInputFocus };
}
