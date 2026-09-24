/**
 * @file 左侧角色列表：29 张主卡按内置顺序排列，会话按 character_name 归到各主卡下；
 * 由 cardLayout 按折叠状态与子卡数量算出每块的 top，容器可纵向滚动并做顶/底/右三段渐隐。
 * 数据来自 chatStore（conversations、collapsedCharacters），放在 DesignCanvas 内按设计坐标绝对定位。
 */
import { CHARACTERS } from '@/constants/characters';
import { useChatStore } from '@/features/chat/chatStore';
import { computeCardPadTop, computeUnitTops } from '@/features/characters/cardLayout';
import { CharacterCardItem } from '@/features/characters/CharacterCardItem';

/** 角色主卡 / 会话子卡列表 */
export function CharacterCardList() {
  const conversations = useChatStore((s) => s.conversations);
  const collapsedCharacters = useChatStore((s) => s.collapsedCharacters);

  // 会话列表本身已按"角色内置顺序 + 创建时间"排序，按角色切分后顺序不变
  const groups = CHARACTERS.map((c) =>
    conversations.filter((conv) => conv.character_name === c.name),
  );
  const collapsed = CHARACTERS.map((c) => collapsedCharacters[c.name]);
  const subCounts = groups.map((g) => g.length);
  const tops = computeUnitTops(collapsed, subCounts);
  const padTop = computeCardPadTop(collapsed, subCounts, tops);

  return (
    <section className="absolute top-[122.57px] left-0 h-[897.27px] w-[526px] [scrollbar-width:thin] [scrollbar-color:var(--color-scrollbar-character)_transparent] overflow-x-hidden overflow-y-auto scroll-mask [--mask-bottom-in:calc(100%_-_80px)] [--mask-bottom-out:calc(100%_-_40px)] [--mask-right:14px] [--mask-top-in:0px] [--mask-top-out:5px]">
      {CHARACTERS.map((character, i) => (
        <CharacterCardItem
          key={character.name}
          character={character}
          conversations={groups[i]}
          collapsed={collapsed[i]}
          top={tops[i]}
        />
      ))}
      {/* 尾部 80px 留白：让最后一张卡能滚出底部渐隐区 */}
      <div className="pointer-events-none absolute left-0 h-[80px] w-px" style={{ top: padTop }} />
    </section>
  );
}
