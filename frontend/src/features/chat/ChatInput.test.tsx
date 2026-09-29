/**
 * @file ChatInput 测试（组件接线层）：Enter 与发送按钮把文本交给 chatStore.sendMessage 并清空、
 * 经表情弹层把表情插到光标处并序列化为 token、弹层外 pointerdown 关闭、流式期间禁用输入且发送按钮变停止、
 * 回复期间点击仍开着的弹层不插入表情、按用户的打字机开关传给 sendMessage（设置未加载时默认开启）。键盘、输入法、粘贴、光标等编辑规则的细节见 useChatComposer.test.tsx。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '@/features/chat/ChatInput';
import { useChatStore } from '@/features/chat/chatStore';
import type { Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 渲染输入面板并替换 store 里的发送 / 停止动作为 spy */
function setup() {
  const sendMessage = vi.fn<(text: string, typewriter: boolean) => Promise<void>>(async () => {});
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
    useSettingsStore.setState({ settings: null });
  });

  /** Enter 与发送按钮：序列化文本交给 store 发送，输入框清空 */
  it('Enter 与发送按钮都发送并清空输入框', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好', true);
    expect(input.innerHTML).toBe('');
    await userEvent.type(input, '在吗');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(sendMessage).toHaveBeenLastCalledWith('在吗', true);
    expect(input.innerHTML).toBe('');
    // 发送按钮按下时不抢焦点，可以接着输入下一条
    expect(document.activeElement).toBe(input);
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
    expect(sendMessage).toHaveBeenCalledWith('你好[sns_emoji_001]世界', true);
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
        typing: false,
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

  /** 打开弹层后发送，回复期间点弹层里的表情不插入；回复结束后再点，表情插到光标处 */
  it('回复期间点击弹层表情不插入，结束后正常插入', async () => {
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.click(screen.getByRole('button', { name: '表情' }));
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好', true);
    act(() => {
      useChatStore.setState({
        streaming: {
          conversationId: 1,
          bubbles: [],
          typing: false,
          pending: true,
          controller: new AbortController(),
        },
      });
    });
    await userEvent.click(screen.getByRole('button', { name: '[sns_emoji_001]' }));
    expect(input.innerHTML).toBe('');

    act(() => {
      useChatStore.setState({ streaming: null });
    });
    await userEvent.click(screen.getByRole('button', { name: '[sns_emoji_001]' }));
    expect(input.querySelector('img')?.dataset.emoji).toBe('[sns_emoji_001]');
  });

  /** 用户关闭了打字机：发送时把 false 交给 store，回复整行显示 */
  it('按用户的打字机开关发送', async () => {
    useSettingsStore.setState({ settings: { typewriter: false } as Settings });
    const { sendMessage, input } = setup();
    await userEvent.type(input, '你好');
    await userEvent.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith('你好', false);
  });
});
