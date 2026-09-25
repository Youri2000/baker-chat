/**
 * @file ChatInput 测试：Enter 发送并清空、Shift+Enter 换行、空白不发送、粘贴只取纯文本、
 * 表情插入到光标处并序列化为 token、输入框失焦后表情插到末尾、流式期间禁用输入且发送按钮变停止、
 * 弹层外 pointerdown 关闭。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '@/features/chat/ChatInput';
import { useChatStore } from '@/features/chat/chatStore';

/** jsdom 没有 execCommand：桩实现把 insertText 的文本追加到当前焦点元素末尾 */
function stubExecCommand() {
  const fn = vi.fn((_command: string, _ui: boolean, text?: string) => {
    document.activeElement?.append(document.createTextNode(text ?? ''));
    return true;
  });
  document.execCommand = fn;
  return fn;
}

/** 渲染输入面板并替换 store 里的发送 / 停止动作为 spy */
function setup() {
  const sendMessage = vi.fn<(text: string) => Promise<void>>(async () => {});
  const stopGeneration = vi.fn();
  useChatStore.setState({ sendMessage, stopGeneration });
  render(<ChatInput />);
  return {
    sendMessage,
    stopGeneration,
    input: screen.getByRole('textbox', { name: '发消息输入框' }),
  };
}

describe('ChatInput', () => {
  beforeEach(() => {
    useChatStore.setState({ streaming: null, activeConversationId: 1 });
    stubExecCommand();
  });

  /** Enter：序列化文本发送，输入框清空 */
  it('Enter 发送并清空输入框', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好');
    expect(input.innerHTML).toBe('');
  });

  /** Shift+Enter：插入换行不发送；随后 Enter 发出两行 */
  it('Shift+Enter 换行，Enter 发出两行', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '\n');
    await userEvent.type(input, '在吗');
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好\n在吗');
  });

  /** 空白内容不能发送 */
  it('空白不发送', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '   ');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  /** 粘贴只取 text/plain */
  it('粘贴只保留纯文本', () => {
    const { input } = setup();
    input.focus();
    fireEvent.paste(input, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? '纯文本' : '<b>x</b>') },
    });
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '纯文本');
  });

  /** 光标放在"你好|世界"中间点第 1 个表情：显示为图片，发送时为 token */
  it('表情插入到光标位置并序列化为 token', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好世界');
    window.getSelection()!.collapse(input.firstChild, 2);
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    await userEvent.click(screen.getByRole('button', { name: '[sns_emoji_001]' }));
    const img = input.querySelector('img');
    expect(img?.dataset.emoji).toBe('[sns_emoji_001]');
    expect(img?.previousSibling?.textContent).toBe('你好');
    expect(img?.nextSibling?.textContent).toBe('世界');
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好[sns_emoji_001]世界');
  });

  /** 输入框失焦（选区在别处）后点表情：插到内容末尾而不是开头，焦点回到输入框 */
  it('输入框失焦后表情插到末尾', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    // 模拟 Chrome：contenteditable 失焦后再 focus() 会把光标放到开头
    input.addEventListener('focus', () => window.getSelection()!.collapse(input, 0));
    input.blur();
    window.getSelection()!.collapse(document.body, 0);
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    await userEvent.click(screen.getByRole('button', { name: '[sns_emoji_001]' }));
    const img = input.querySelector('img')!;
    expect(img.previousSibling?.textContent).toBe('你好');
    expect(img.nextSibling).toBeNull();
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好[sns_emoji_001]');
  });

  /** 弹层外按下指针关闭弹层，表情按钮自身不关闭 */
  it('弹层以外 pointerdown 关闭弹层', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    expect(screen.getByRole('button', { name: '[sns_emoji_001]' })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '[sns_emoji_002]' }));
    expect(screen.getByRole('button', { name: '[sns_emoji_001]' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: '[sns_emoji_001]' })).not.toBeInTheDocument();
  });

  /** 流式期间：输入框不可编辑，发送按钮换成停止，点击停止调用 stopGeneration */
  it('流式期间禁用输入并显示停止按钮', async () => {
    useChatStore.setState({
      streaming: {
        conversationId: 1,
        bubbles: [],
        pending: true,
        controller: new AbortController(),
      },
    });
    const { stopGeneration, input } = setup();
    expect(input).toHaveAttribute('contenteditable', 'false');
    expect(input).toHaveAttribute('data-disabled');
    expect(screen.getByRole('button', { name: '表情' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(stopGeneration).toHaveBeenCalledOnce();
  });
});
