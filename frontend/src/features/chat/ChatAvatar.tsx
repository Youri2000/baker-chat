/**
 * @file 聊天头像：98px 头像盒内三层叠加——底图、圆形裁剪的肖像、旋转 180° 并外扩 3% 的环形框。
 * 各层相对坐标来自 constants/design 的 AVATAR；位置由 ChatMessageRow 通过 style 注入。
 * 传入 onClick 时（我方头像）可点击切换管理员性别。
 */
import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { AVATAR } from '@/constants/design';
import { MATERIALS } from '@/constants/materials';

/** 圆形肖像相对环形框左移 1px（视觉微调，与原项目一致） */
const PORTRAIT_X_ADJ = -1;

/** ChatAvatar 属性 */
export interface ChatAvatarProps {
  /** 肖像图片 URL：角色头像或管理员头像 */
  src: string;
  /** 头像盒定位（由行布局给出） */
  style: CSSProperties;
  /** 我方头像：点击切换管理员性别 */
  onClick?: () => void;
}

/** 三层头像 */
export function ChatAvatar({ src, style, onClick }: ChatAvatarProps) {
  const clickable = onClick !== undefined;
  return (
    <div
      className={clsx('absolute h-[98px] w-[98px]', clickable && 'cursor-pointer')}
      style={style}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? '切换我方头像' : undefined}
      onClick={onClick}
    >
      <img className="absolute inset-0 h-full w-full" src={MATERIALS.avatarBase} alt="" />
      {/* 圆形裁剪夹层：内部肖像放大 1.4 倍、取上端区域，只露出头部 */}
      <div
        className="absolute z-[1] overflow-hidden rounded-full"
        style={{
          left: AVATAR.portrait.x + PORTRAIT_X_ADJ,
          top: AVATAR.portrait.y,
          width: AVATAR.portrait.w,
          height: AVATAR.portrait.h,
        }}
      >
        <img className="h-full w-full scale-[1.4] object-cover object-top" src={src} alt="" />
      </div>
      <img
        className="absolute z-[2] scale-[1.03] rotate-180"
        style={{
          left: AVATAR.ring.x,
          top: AVATAR.ring.y,
          width: AVATAR.ring.w,
          height: AVATAR.ring.h,
        }}
        src={MATERIALS.avatarFrame}
        alt=""
      />
    </div>
  );
}
