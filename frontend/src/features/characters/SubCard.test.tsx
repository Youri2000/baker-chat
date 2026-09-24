/**
 * @file SubCard 测试：空会话按性别显示占位文案、表情 token 渲染为 <img>、单击选中会话并同步主卡。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import { EMOJIS } from '@/constants/emoji';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { SubCard } from '@/features/characters/SubCard';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 构造一段会话 */
function conversation(id: number, name: string, text: string | null): Conversation {
  return {
    id,
    character_name: name,
    last_message: text === null ? null : { side: 'other', text },
    created_at: '',
    updated_at: '',
  };
}

describe('SubCard', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
    });
  });

  /** 无消息：女性角色"和她聊聊"，男性角色"和他聊聊" */
  it('空会话按角色性别显示占位文案', () => {
    render(
      <>
        <SubCard conversation={conversation(1, '陈千语', null)} gender="female" top={0} />
        <SubCard conversation={conversation(2, '卡缪', null)} gender="male" top={0} />
      </>,
    );
    expect(screen.getByText('和她聊聊')).toBeInTheDocument();
    expect(screen.getByText('和他聊聊')).toBeInTheDocument();
  });

  /** 有消息：显示最后一条，表情 token 变成图片而不是文本 */
  it('预览里的表情 token 渲染为 <img>', () => {
    render(
      <SubCard
        conversation={conversation(1, '陈千语', '你好[sns_emoji_001]世界')}
        gender="female"
        top={0}
      />,
    );
    const card = screen.getByRole('button');
    const img = card.querySelector(`img[src="${EMOJIS[0].src}"]`) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.style.width).toBe('1em');
    expect(card).toHaveTextContent('你好世界');
    expect(card).not.toHaveTextContent('[sns_emoji_001]');
  });

  /** 单击：store 选中该会话与所属主卡，拉取消息；卡片出现 data-selected */
  it('单击选中会话并同步选中所属主卡', async () => {
    const conv = conversation(7, '陈千语', null);
    useChatStore.setState({ conversations: [conv] });
    mockFetch((req) =>
      req.path === '/api/conversations/7/messages'
        ? jsonResponse([])
        : jsonResponse({ detail: 'not found' }, 404),
    );
    render(<SubCard conversation={conv} gender="female" top={0} />);
    const card = screen.getByRole('button');
    expect(card).not.toHaveAttribute('data-selected');
    fireEvent.click(card);
    await waitFor(() => expect(card).toHaveAttribute('data-selected'));
    const s = useChatStore.getState();
    expect(s.activeConversationId).toBe(7);
    expect(s.activeCharacterName).toBe('陈千语');
    expect(s.messagesByConversation[7]).toEqual([]);
  });
});
