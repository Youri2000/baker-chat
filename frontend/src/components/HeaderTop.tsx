/**
 * @file 页头 "//BAKER/会话消息"：装饰图 + 标题，像素还原原 HeaderTop.vue。
 * 根元素是零尺寸原点容器，只承载绝对定位子元素，不拦截鼠标事件。
 */
import { MATERIALS } from '@/constants/materials';

/** 页头标题 */
export function HeaderTop() {
  return (
    <header className="absolute top-0 left-0 h-0 w-0">
      <img
        className="absolute top-[18.92px] left-[43px] h-[12px] w-[63px]"
        src={MATERIALS.headerDeco}
        alt=""
      />
      <p className="absolute top-[32.83px] left-[43px] text-title leading-none font-medium tracking-[-0.5px] whitespace-nowrap text-text-primary select-text">
        //BAKER/会话消息
      </p>
    </header>
  );
}
