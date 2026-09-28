/**
 * @file 回到底部按钮：用户向上浏览、暂停跟随时出现在消息区下方、输入面板上方，水平居中于消息区。
 * 没有新消息时文字为"回到底部"，暂停期间有新的消息行到达后变为"有新消息"；不显示未读条数。
 * 原项目没有这个控件：只复用现有令牌与素材（按钮浅灰底、深灰字、卡片箭头、气泡阴影、对话框淡入）。
 */
import { BACK_TO_BOTTOM } from '@/constants/design';
import { MATERIALS } from '@/constants/materials';

/** BackToBottomButton 属性 */
export interface BackToBottomButtonProps {
  /** 暂停跟随期间是否有新的消息行到达 */
  hasNew: boolean;
  /** 点击：平滑滚到底部并恢复跟随 */
  onClick: () => void;
}

/**
 * 回到底部按钮
 * ⚠️ 按钮挂在 ChatArea 的 0×0 定位容器里，只给 left 的绝对定位元素按收缩适配取宽，可用宽度为 0 时退化成最窄内容宽度，
 * 文字会一字一行溢出胶囊，所以必须 whitespace-nowrap（与同一容器里的角色名一致）
 */
export function BackToBottomButton({ hasNew, onClick }: BackToBottomButtonProps) {
  return (
    <button
      type="button"
      className="absolute z-[5] flex -translate-x-1/2 animate-dialog-in cursor-pointer items-center rounded-full bg-btn-bg whitespace-nowrap text-btn-icon drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)] after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:bg-hover-overlay-gray after:opacity-0 after:transition-opacity after:duration-150 after:content-[''] hover:after:opacity-100"
      style={{
        left: BACK_TO_BOTTOM.centerX,
        top: BACK_TO_BOTTOM.y,
        height: BACK_TO_BOTTOM.h,
        paddingInline: BACK_TO_BOTTOM.padX,
        gap: BACK_TO_BOTTOM.gap,
        fontSize: BACK_TO_BOTTOM.fontSize,
      }}
      onClick={onClick}
    >
      {hasNew ? '有新消息' : '回到底部'}
      {/* 卡片箭头素材本身朝下（浅色），压暗成与文字相同的深灰 */}
      <img
        className="pointer-events-none h-auto max-w-none brightness-[0.267] select-none"
        style={{ width: BACK_TO_BOTTOM.arrow }}
        src={MATERIALS.cardArrow}
        alt=""
      />
    </button>
  );
}
