/**
 * @file CharacterCardList 测试：29 张主卡按内置顺序、主卡 top 随折叠与子卡数量变化，
 * 以及 spec "展开主卡并选中会话" 场景：点"陈千语"主卡再点子卡，store 选中会话并加载消息。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '@/constants/characters';
import { EMOJIS } from '@/constants/emoji';
import type { Conversation, Message } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { CharacterCardList } from '@/features/characters/CharacterCardList';
import { jsonResponse, mockFetch } from '@/test/mockFetch';

/** 每个角色一段空会话，陈千语额外多一段有消息的会话（保持后端"角色顺序 + 创建时间"排序） */
const CONVERSATIONS: Conversation[] = CHARACTERS.flatMap((c, i) => {
  const base: Conversation = {
    id: i + 1,
    character_name: c.name,
    last_message: null,
    created_at: '',
    updated_at: '',
  };
  if (c.name !== '陈千语') return [base];
  return [
    base,
    { ...base, id: 100, last_message: { side: 'other', text: '晚上好[sns_emoji_002]' } },
  ];
});

/** 会话 100 的历史消息 */
const HISTORY: Message[] = [
  { id: 1, side: 'mine', text: '你好', status: 'completed', created_at: '' },
  { id: 2, side: 'other', text: '晚上好[sns_emoji_002]', status: 'completed', created_at: '' },
];

/** 主卡块根元素（带 top 的那一层）的 top 值 */
function unitTopOf(name: string): number {
  const unit = screen.getByRole('button', { name }).parentElement as HTMLElement;
  return Number.parseFloat(unit.style.top);
}

describe('CharacterCardList', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: CONVERSATIONS,
      messagesByConversation: {},
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
    });
  });

  /** 29 张主卡按内置顺序，全部折叠时等距 100.86 */
  it('渲染 29 张主卡并按折叠间距排列', () => {
    render(<CharacterCardList />);
    const names = screen.getAllByRole('button').map((el) => el.textContent);
    expect(names).toEqual(CHARACTERS.map((c) => c.name));
    expect(unitTopOf(CHARACTERS[0].name)).toBe(10);
    expect(unitTopOf(CHARACTERS[1].name)).toBeCloseTo(110.86, 5);
  });

  /** 展开陈千语（2 段会话）后，下一张主卡被推后 2 张子卡 + 间距 */
  it('展开主卡后后续主卡的 top 按子卡数量后移', () => {
    render(<CharacterCardList />);
    const index = CHARACTERS.findIndex((c) => c.name === '陈千语');
    const before = unitTopOf(CHARACTERS[index + 1].name);
    fireEvent.click(screen.getByRole('button', { name: '陈千语' }));
    const after = unitTopOf(CHARACTERS[index + 1].name);
    expect(after - before).toBeCloseTo(2 * 68.95 + 4.61 + 7.87, 5);
  });

  /** spec：点击"陈千语"主卡再单击其子卡 → 主卡展开并选中、子卡选中、消息已加载 */
  it('展开主卡并选中会话', async () => {
    mockFetch((req) =>
      req.path === '/api/conversations/100/messages'
        ? jsonResponse(HISTORY)
        : jsonResponse({ detail: 'not found' }, 404),
    );
    render(<CharacterCardList />);
    fireEvent.click(screen.getByRole('button', { name: '陈千语' }));
    const card = screen.getByRole('button', { name: '陈千语' });
    expect(card).toHaveAttribute('data-selected');
    // 第二段会话的预览：文本 + 表情图片（accessible name 只含文本）
    const sub = screen.getByRole('button', { name: '晚上好' });
    expect(sub.querySelector(`img[src="${EMOJIS[1].src}"]`)).not.toBeNull();
    fireEvent.click(sub);
    await waitFor(() => expect(sub).toHaveAttribute('data-selected'));
    const s = useChatStore.getState();
    expect(s.activeConversationId).toBe(100);
    expect(s.activeCharacterName).toBe('陈千语');
    expect(s.messagesByConversation[100]).toEqual(HISTORY);
    // 其他角色的子卡未展开、主卡未选中
    expect(screen.getByRole('button', { name: '洛茜' })).not.toHaveAttribute('data-selected');
    expect(screen.getAllByRole('button', { name: '和她聊聊' })).toHaveLength(1);
  });
});
