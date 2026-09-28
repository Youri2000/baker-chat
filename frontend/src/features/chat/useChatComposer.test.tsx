/**
 * @file useChatComposer 测试：用一个把 inputRef 与处理器绑到真实 contenteditable 上的宿主组件驱动 Hook。
 * 覆盖 Enter 发送并清空、Shift/Ctrl/Cmd/Alt+Enter 换行不发送、换行后发出两行、输入法选词时不发送、
 * 空白不发送、粘贴只插入纯文本、表情插入到光标处（按钮不抢焦点，选区留在原处）并序列化为 token、选区不在输入框时插到末尾、
 * 禁用时 submit 与 insertEmoji 不生效。Hook 不注册监听器或 observer，卸载无需清理，故不单测卸载。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMOJIS } from '@/constants/emoji';
import { useChatComposer, type ChatComposerOptions } from '@/features/chat/useChatComposer';

/**
 * 测试宿主：输入框、发送按钮、表情按钮（插入第 1 个表情）的接法与 ChatInput 相同。
 * ⚠️ 输入框始终可编辑，禁用规则只由 Hook 自己保证，不依赖 contenteditable=false。
 */
function Host({ onSend, disabled }: ChatComposerOptions) {
  const { inputRef, handleKeyDown, handlePaste, insertEmoji, submit, keepInputFocus } =
    useChatComposer({ onSend, disabled });
  return (
    <>
      <div
        ref={inputRef}
        role="textbox"
        aria-label="输入框"
        contentEditable
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      <button type="button" onMouseDown={keepInputFocus} onClick={submit}>
        发送
      </button>
      <button type="button" onMouseDown={keepInputFocus} onClick={() => insertEmoji(EMOJIS[0])}>
        表情
      </button>
    </>
  );
}

/** jsdom 没有 execCommand：桩实现把 insertText 的文本追加到当前焦点元素末尾 */
function stubExecCommand() {
  const fn = vi.fn((_command: string, _ui: boolean, text?: string) => {
    document.activeElement?.append(document.createTextNode(text ?? ''));
    return true;
  });
  document.execCommand = fn;
  return fn;
}

/** 渲染宿主，onSend 为 spy；返回 rerender 以便切换 disabled */
function setup(disabled = false) {
  const onSend = vi.fn<(text: string) => Promise<void>>(async () => {});
  const { rerender } = render(<Host onSend={onSend} disabled={disabled} />);
  return {
    onSend,
    input: screen.getByRole('textbox', { name: '输入框' }),
    /** 以新的 disabled 重新渲染 */
    setDisabled: (next: boolean) => rerender(<Host onSend={onSend} disabled={next} />),
  };
}

describe('useChatComposer', () => {
  beforeEach(() => {
    stubExecCommand();
  });

  /** Enter：序列化文本交给 onSend，输入框清空 */
  it('Enter 发送并清空输入框', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好');
    expect(input.innerHTML).toBe('');
  });

  /** 任一修饰键 + Enter：插入换行，不发送 */
  it.each(['Shift', 'Control', 'Meta', 'Alt'])('%s+Enter 插入换行不发送', async (modifier) => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
    expect(onSend).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith('insertText', false, '\n');
  });

  /** Shift+Enter 换行后再输入，Enter 发出两行 */
  it('Shift+Enter 换行后 Enter 发出两行', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await userEvent.type(input, '在吗');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好\n在吗');
  });

  /** 输入法选词阶段的 Enter 不拦截也不发送（交给输入法上屏）；上屏后再按 Enter 才发送 */
  it('输入法选词时 Enter 不发送', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好');
    // fireEvent 返回 false 表示默认行为被阻止；选词时必须放行
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(input.textContent).toBe('你好');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好');
  });

  /** 只有空白：Enter 和发送按钮都不发送，内容保留 */
  it('空白内容不发送', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '   ');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(input.textContent).toBe('   ');
  });

  /** 粘贴：阻止默认粘贴，只用 text/plain 插入 */
  it('粘贴只插入纯文本', () => {
    const { input } = setup();
    input.focus();
    const notPrevented = fireEvent.paste(input, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? '纯文本' : '<b>x</b>') },
    });
    expect(notPrevented).toBe(false);
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith('insertText', false, '纯文本');
    expect(input.innerHTML).toBe('纯文本');
  });

  /** 光标放在"你好|世界"中间后按表情按钮：焦点与光标保住，表情插在光标处，光标停在表情后，发送时为 token */
  it('表情插入到光标处（按钮不抢焦点，选区留在原处）并序列化为 token', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好世界');
    window.getSelection()!.collapse(input.firstChild, 2);
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    expect(document.activeElement).toBe(input);
    const img = input.querySelector('img')!;
    expect(img.dataset.emoji).toBe('[sns_emoji_001]');
    expect(img.previousSibling?.textContent).toBe('你好');
    expect(img.nextSibling?.textContent).toBe('世界');
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer.childNodes[range.startOffset - 1]).toBe(img);
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好[sns_emoji_001]世界');
    expect(input.innerHTML).toBe('');
  });

  /** 输入框失焦且选区在别处：表情插到内容末尾而不是开头，焦点回到输入框 */
  it('选区不在输入框时表情插到末尾', async () => {
    const { onSend, input } = setup();
    await userEvent.type(input, '你好');
    // 模拟 Chrome：contenteditable 失焦后再 focus() 会把光标放到开头
    input.addEventListener('focus', () => window.getSelection()!.collapse(input, 0));
    input.blur();
    window.getSelection()!.collapse(document.body, 0);
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    const img = input.querySelector('img')!;
    expect(img.previousSibling?.textContent).toBe('你好');
    expect(img.nextSibling).toBeNull();
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好[sns_emoji_001]');
  });

  /** 禁用时 Enter、发送按钮、插入表情都不生效且内容保留；解除禁用后表情照常插入、Enter 照常发送 */
  it('禁用时 submit 与 insertEmoji 不生效', async () => {
    const { onSend, input, setDisabled } = setup(true);
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(input.innerHTML).toBe('你好');

    setDisabled(false);
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    expect(input.querySelector('img')?.dataset.emoji).toBe('[sns_emoji_001]');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('你好[sns_emoji_001]');
  });
});
