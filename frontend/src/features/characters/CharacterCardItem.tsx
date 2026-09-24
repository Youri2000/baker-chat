/**
 * @file 单张角色主卡及其下的会话子卡：主卡视觉（底色/纹理/名字/头像/聊天角标/折叠箭头）、点击切换折叠并
 * 选中主卡（chatStore.toggleCharacter）、展开时按 cardLayout.subTopInCard 排布子卡。
 * 像素还原原 CharacterCardItem.vue；hover 白层改用 CSS :hover + group，主卡与子卡是兄弟元素，
 * 指针从主卡移到子卡时浏览器同一帧切换两者的 :hover，不再需要 relatedTarget 判断。
 */
import type { Character } from '@/constants/characters';
import { MATERIALS } from '@/constants/materials';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';
import { subTopInCard } from '@/features/characters/cardLayout';
import { SubCard } from '@/features/characters/SubCard';

/** CharacterCardItem 属性 */
export interface CharacterCardItemProps {
  character: Character;
  /** 该角色的全部会话，按创建时间升序 */
  conversations: Conversation[];
  collapsed: boolean;
  /** 主卡块在列表容器内的 top（由 cardLayout.computeUnitTops 算出） */
  top: number;
}

/** 角色主卡 + 子卡 */
export function CharacterCardItem({
  character,
  conversations,
  collapsed,
  top,
}: CharacterCardItemProps) {
  const isSelected = useChatStore((s) => s.activeCharacterName === character.name);
  const toggleCharacter = useChatStore((s) => s.toggleCharacter);

  /** 点击主卡任意位置：切换折叠 + 设为选中主卡 */
  const handleClick = () => {
    toggleCharacter(character.name);
  };

  return (
    // 卡片块：折叠/展开时整块上下位移，0.3s 过渡
    <div
      className="absolute left-0 size-0 transition-[top] duration-(--anim-card-collapse) ease-default"
      style={{ top }}
    >
      <div
        role="button"
        data-collapsed={collapsed || undefined}
        data-selected={isSelected || undefined}
        className="group/card absolute top-0 left-[47.42px] size-0 cursor-pointer"
        onClick={handleClick}
      >
        <div className="absolute top-0 left-0 h-[92.99px] w-[458.28px] rounded-card bg-card-bg" />
        <img
          className="absolute top-0 left-0 h-[92.4px] w-[457.6px] max-w-none opacity-50"
          src={MATERIALS.cardTexture}
          alt=""
        />
        <img
          className="absolute top-[0.38px] left-[35.28px] h-[92.04px] w-[422.76px] max-w-none opacity-[0.02]"
          src={MATERIALS.cardFaint}
          alt=""
        />
        <p className="absolute top-[32.32px] left-[102.02px] max-w-[300px] truncate text-name leading-none font-medium text-text-primary select-text">
          {character.name}
        </p>
        <img
          className="absolute top-[62.72px] left-[104.02px] h-[4.5px] w-[42.75px] max-w-none opacity-40"
          src={MATERIALS.underline}
          alt=""
        />
        <img
          className="absolute top-[15.75px] left-[394.21px] h-[6px] w-[45px] max-w-none opacity-40"
          src={MATERIALS.cornerDeco}
          alt=""
        />
        {/* 头像框在 hover 白层之上；内层裁剪盒限制放大后的可见范围，外层保持可见让角标探出边框 */}
        <div className="absolute top-[8.5px] left-[8.5px] z-11 size-[76px] rounded-avatar-card border border-avatar-border group-hover/card:border-avatar-border-hover">
          <div className="absolute inset-0 overflow-hidden rounded-avatar-card">
            {/* 竖幅原图取上端正方形，再放大 1.1 收紧到头部 */}
            <img
              className="relative z-11 h-full w-full origin-[center_45%] scale-110 object-cover object-top"
              src={character.avatar}
              alt=""
            />
          </div>
          <img
            className="pointer-events-none absolute top-[-16px] right-[-20px] z-12 origin-center animate-card-chat-wiggle"
            src={MATERIALS.chatBadge}
            alt=""
          />
        </div>
        {/* 折叠按钮只是视觉：点击由整卡接管；展开时箭头 180°，折叠时转回 0° */}
        <span className="pointer-events-none absolute top-[52.31px] left-[415.92px] size-[31.2px]">
          <img
            className="absolute inset-0 h-full w-full opacity-40"
            src={MATERIALS.circleBorder}
            alt=""
          />
          <img
            className="absolute top-[8.475px] left-[6.6px] h-[14.25px] w-[18px] max-w-none rotate-180 opacity-40 transition-transform duration-(--anim-card-collapse) ease-default group-data-collapsed/card:rotate-0"
            src={MATERIALS.cardArrow}
            alt=""
          />
        </span>
        {/* 💡 hover 白层交给 CSS :hover 而非 React 状态：主卡与子卡是兄弟元素，浏览器同帧切换，hover 全程 0 次渲染，详见 docs/interview.md#hover-css */}
        <span className="pointer-events-none absolute top-0 left-0 z-10 h-[92.99px] w-[458.28px] rounded-card bg-hover-overlay opacity-0 transition-opacity duration-(--anim-fast) ease-default group-hover/card:opacity-100 group-data-selected/card:opacity-100" />
      </div>
      {/* 子卡容器：展开时挂载并播放 0.25s 下落淡入，折叠时直接卸载 */}
      {!collapsed && (
        <div className="absolute top-0 left-0 size-0 animate-collapse-in">
          {conversations.map((conversation, k) => (
            <SubCard
              key={conversation.id}
              conversation={conversation}
              gender={character.gender}
              top={subTopInCard(k)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
