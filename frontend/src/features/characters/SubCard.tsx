/**
 * @file 会话子卡：显示最后一条消息预览（表情 token 渲染为图片，超长省略）或按角色性别的空态文案；
 * 单击选中该会话（chatStore.selectConversation 同时选中所属主卡）。像素还原原 SubCard.vue，
 * 选中/hover 视觉全部由 data-selected 属性与 group-hover 驱动，不经过 React 状态。
 */
import type { CharacterGender } from '@/constants/characters';
import { splitEmojiText } from '@/constants/emoji';
import { MATERIALS } from '@/constants/materials';
import type { Conversation } from '@/features/chat/api';
import { useChatStore } from '@/features/chat/chatStore';

/** SubCard 属性 */
export interface SubCardProps {
  conversation: Conversation;
  /** 所属角色性别，决定空会话的占位文案 */
  gender: CharacterGender;
  /** 相对主卡块顶部的 top（由 cardLayout.subTopInCard 算出） */
  top: number;
}

/** 预览内容：有消息时为最后一条（表情 token 换成 <img>），否则按性别显示"和他/她聊聊" */
function previewNodes(conversation: Conversation, gender: CharacterGender) {
  if (conversation.last_message === null) return gender === 'male' ? '和他聊聊' : '和她聊聊';
  return splitEmojiText(conversation.last_message.text).map((part, i) =>
    typeof part === 'string' ? (
      part
    ) : (
      // preflight 把 img 设为块级，行内表情必须显式 inline-block；高 1em、宽按原图比例
      <img
        key={i}
        className="inline-block h-[1em] object-contain align-middle"
        style={{ width: `${part.aspect}em` }}
        src={part.src}
        alt=""
      />
    ),
  );
}

/** 会话子卡 */
export function SubCard({ conversation, gender, top }: SubCardProps) {
  // 只在"自己是否选中"翻转时重渲染，选中别的会话不会波及本卡
  const isSelected = useChatStore((s) => s.activeConversationId === conversation.id);
  const selectConversation = useChatStore((s) => s.selectConversation);

  /** 单击：选中会话并同步选中所属主卡 */
  const handleClick = () => {
    void selectConversation(conversation.id);
  };

  return (
    <div
      role="button"
      data-selected={isSelected || undefined}
      className="group/sub absolute left-[70.77px] size-0 cursor-pointer"
      style={{ top }}
      onClick={handleClick}
    >
      {/* 💡 零尺寸容器内的 img 必须 max-w-none：preflight 的 max-width:100% 会把宽度压成 0，详见 docs/interview.md#preflight-max-width */}
      {/* 底色矩形；内层黄层选中时从左向右横向展开 */}
      <div className="absolute top-0 left-0 h-[68.95px] w-[435.53px] rounded-subcard bg-subcard-bg">
        <span className="absolute inset-0 origin-left scale-x-0 rounded-[inherit] bg-subcard-selected transition-transform duration-(--anim-subcard-selected) ease-out group-data-selected/sub:scale-x-100" />
      </div>
      <img
        className="absolute top-0 left-0 h-[68.4px] w-[434.72px] max-w-none opacity-50 transition-opacity duration-(--anim-subcard) ease-default group-data-selected/sub:opacity-0"
        src={MATERIALS.cardTexture}
        alt=""
      />
      <img
        className="absolute top-[0.38px] left-[297.93px] h-[68px] w-[137.6px] max-w-none opacity-[0.02]"
        src={MATERIALS.subFaint}
        alt=""
      />
      <div className="absolute top-[9.93px] left-[11.93px] size-[49.08px] rounded-icon-box bg-subcard-icon-box transition-opacity duration-(--anim-subcard) ease-default group-data-selected/sub:opacity-0" />
      {/* 两支选中箭头：首支 0.15s、次支 0.25s，选中时从左滑入并显示为 15% */}
      <img
        className="absolute top-[0.16px] left-[70.89px] h-[71.04px] w-[48px] max-w-none -translate-x-[40px] opacity-0 brightness-[0.11] transition-[translate,opacity] duration-(--anim-subcard-arrow-first) ease-out group-data-selected/sub:translate-x-0 group-data-selected/sub:opacity-15"
        src={MATERIALS.subArrow}
        alt=""
      />
      <img
        className="absolute top-0 left-[115.45px] h-[71.04px] w-[48px] max-w-none -translate-x-[40px] opacity-0 brightness-[0.11] transition-[translate,opacity] duration-(--anim-subcard) ease-out group-data-selected/sub:translate-x-0 group-data-selected/sub:opacity-15"
        src={MATERIALS.subArrow}
        alt=""
      />
      <img
        className="absolute top-[24.31px] left-[20.72px] h-[25.5px] w-[31.5px] max-w-none brightness-[0.882] transition-[filter] duration-(--anim-subcard) ease-default group-data-selected/sub:brightness-[0.11]"
        src={MATERIALS.chatBadge}
        alt=""
      />
      {/* 可视宽度 = 435.53 − 82.59 − 右侧留白 25.94 ≈ 327，超出省略 */}
      <p className="absolute top-[24.32px] left-[82.59px] max-w-[327px] truncate text-subcard leading-none text-subcard-text transition-colors duration-(--anim-subcard) ease-default select-text group-data-selected/sub:text-subcard-text-selected">
        {previewNodes(conversation, gender)}
      </p>
      <img
        className="absolute top-[11.43px] left-[26.76px] size-[29.19px] max-w-none opacity-0 brightness-[0.11] transition-opacity duration-(--anim-subcard) ease-default group-data-selected/sub:opacity-100"
        src={MATERIALS.decoBadge}
        alt=""
      />
      <img
        className="absolute top-[5.65px] left-[34.99px] h-[11.07px] w-[38.13px] max-w-none -scale-x-100 opacity-0 brightness-[0.11] transition-opacity duration-(--anim-subcard) ease-default group-data-selected/sub:opacity-100"
        src={MATERIALS.decoWing}
        alt=""
      />
      <div className="absolute top-[54.11px] left-[27.38px] h-[0.6px] w-[62.71px] bg-subcard-line opacity-0 transition-opacity duration-(--anim-subcard) ease-default group-data-selected/sub:opacity-100" />
      {/* hover 白层：由 CSS :hover 驱动，指针从主卡移到子卡时两层各自淡入淡出 */}
      <span className="pointer-events-none absolute top-0 left-0 z-10 h-[68.95px] w-[435.53px] rounded-subcard bg-hover-overlay opacity-0 transition-opacity duration-(--anim-fast) ease-default group-hover/sub:opacity-100" />
    </div>
  );
}
