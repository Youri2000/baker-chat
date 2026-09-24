/**
 * @file CharacterCardItem 测试：折叠时不渲染子卡、点击主卡切换折叠并选中、data-collapsed / data-selected
 * 随 store 变化，子卡按 subTopInCard 排布。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS, findCharacter } from '@/constants/characters';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { CharacterCardItem } from '@/features/characters/CharacterCardItem';

/** 陈千语的两段空会话 */
const CONVERSATIONS: Conversation[] = [1, 2].map((id) => ({
  id,
  character_name: '陈千语',
  last_message: null,
  created_at: '',
  updated_at: '',
}));

/** 用 store 里的折叠状态渲染陈千语主卡 */
function renderItem() {
  const collapsed = useChatStore.getState().collapsedCharacters['陈千语'];
  return render(
    <CharacterCardItem
      character={findCharacter('陈千语')}
      conversations={CONVERSATIONS}
      collapsed={collapsed}
      top={10}
    />,
  );
}

describe('CharacterCardItem', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: CONVERSATIONS,
      activeConversationId: null,
      activeCharacterName: null,
      collapsedCharacters: Object.fromEntries(CHARACTERS.map((c) => [c.name, true])),
    });
  });

  /** 默认折叠：只有主卡一个按钮，带 data-collapsed，不出现子卡 */
  it('折叠时只渲染主卡', () => {
    renderItem();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '陈千语' })).toHaveAttribute('data-collapsed');
    expect(screen.queryByText('和她聊聊')).not.toBeInTheDocument();
  });

  /** 点击主卡：store 切换折叠并设为选中主卡 */
  it('点击主卡切换折叠并选中主卡', () => {
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: '陈千语' }));
    const s = useChatStore.getState();
    expect(s.collapsedCharacters['陈千语']).toBe(false);
    expect(s.activeCharacterName).toBe('陈千语');
  });

  /** 展开：两张子卡按 100.86 / 174.42 排布，主卡带 data-selected */
  it('展开时渲染子卡并按间距排布', () => {
    useChatStore.getState().toggleCharacter('陈千语');
    renderItem();
    const card = screen.getByRole('button', { name: '陈千语' });
    expect(card).not.toHaveAttribute('data-collapsed');
    expect(card).toHaveAttribute('data-selected');
    const subs = screen.getAllByRole('button', { name: '和她聊聊' });
    expect(subs).toHaveLength(2);
    expect(subs[0].style.top).toBe('100.86px');
    expect(Number.parseFloat(subs[1].style.top)).toBeCloseTo(174.42, 5);
  });
});
