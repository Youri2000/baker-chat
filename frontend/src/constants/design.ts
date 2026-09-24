/**
 * @file 1920×1080 设计稿坐标（桌面端）：来自原项目 design.ts / chatGeometry.ts 的 DESKTOP_GEOM、
 * characterCard.ts、panel.ts 与 utils/measure.ts。所有数值由设计稿测量，精度保留两位小数，
 * 不得随意调整。组件把这些值写进 Tailwind 任意值或内联 style。
 */

/** 设计画布尺寸（px） */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

/** 左侧角色列表滚动容器与卡片块布局 */
export const CHARACTER_LIST = {
  x: 0,
  y: 122.57,
  w: 526,
  h: 897.27,
  /** 列表顶部留白（第一张主卡前） */
  topPad: 10,
  /** 列表尾部留白 */
  bottomPad: 80,
  /** 主卡高度 */
  cardH: 92.99,
  /** 第一张子卡顶部相对主卡顶部的偏移（= cardH + 7.87 间距） */
  subTopFromCard: 100.86,
  /** 子卡高度 */
  subH: 68.95,
  /** 子卡之间的间距 */
  subGap: 4.61,
  /** 主卡块之间的间距（折叠/展开均适用） */
  blockGap: 7.87,
} as const;

/** 顶部聊天条（点击循环三种样式） */
export const CHAT_STRIP = { x: 546.02, y: 114.44, w: 1323, h: 67.67 } as const;

/** 聊天框（CSS 绘制的边框区域） */
export const CHAT_FRAME_BOX = { x: 546.02, y: 188.84, w: 1323, h: 831 } as const;

/** 消息滚动容器（比聊天框窄 11px，给滚动条留位） */
export const CHAT_SCROLL = { x: 546.02, y: 188.84, w: 1312, h: 831 } as const;

/** 聊天框装饰细节：全部相对框右缘定位，原值 1:1 */
export const CHAT_FRAME = {
  /** 框线宽 */
  line: 1.5,
  /** 顶部线右侧缺口宽 */
  gap: 264,
  /** 缺口内右端小段宽 */
  segW: 32,
  /** SVG 凹口宽/高，凹口上移 6px 悬于框顶线上方 */
  notchW: 232,
  notchH: 10,
  notchLift: 6,
  /** 凹口折线 path（viewBox 0 0 232 10） */
  notchPath: 'M0,0 L16,6 L216,6 L232,0',
  /** 三色发光条：距框右缘、单条宽、间距、高 */
  barsRight: 44,
  barW: 64,
  barGap: 8,
  barH: 2,
} as const;

/** 聊天区空态（未选中会话）区域：顶端对齐第一张主卡，底边与聊天框底边相同 */
export const CHAT_EMPTY = {
  x: CHAT_FRAME_BOX.x,
  top: CHARACTER_LIST.y + CHARACTER_LIST.topPad,
  bottom: CHAT_FRAME_BOX.y + CHAT_FRAME_BOX.h,
  w: CHAT_FRAME_BOX.w,
  /** 空态中心 10×10 点阵 SVG 边长 */
  dotsSize: 140,
} as const;

/** 聊天框右上角装饰（左右镜像，宽 150，透明度 0.2） */
export const CHAT_CORNER_DECO = { x: 1619.02, y: 139.44, w: 150 } as const;

/** 聊天框底部固定装饰 */
export const CHAT_BOTTOM_DECO = { x: 1092.52, y: 993.84, w: 219, h: 13 } as const;

/** 消息流锚点（画布坐标） */
export const CHAT_ANCHOR = {
  /** 首条消息头像顶部 y */
  firstAvatarTop: 243.42,
  /** 对方 / 我方头像盒左缘 x */
  otherAvatarX: 554.48,
  mineAvatarX: 1746.4592,
  /** 对方气泡左缘 x / 我方气泡右缘 x */
  otherBubbleX: 644.64,
  mineBubbleRight: 1746.34,
  /** 滚动内容尾部留白 */
  bottomPad: 100,
} as const;

/** 消息间距：同一说话人连续 / 跨方向 / 同侧换说话人 */
export const CHAT_GAP = { same: 14, cross: 33, speaker: 60 } as const;

// ---- 头像三层（底图 / 圆形肖像 / 旋转 180° 的环形框）--------------------------
const RING_W = 76;
const RING_H = 75.24;
const RING_CX = 0.47; // 环内圆心 x（略偏左）
const RING_CY = 0.458; // 环内圆心 y（略偏上）
const PORTRAIT_SCALE = 0.8; // 肖像直径 = 环尺寸 × 0.8
const ringX = (98 - RING_W) / 2;
const ringY = (98 - RING_H) / 2;

/** 头像盒 98px 内三层的相对坐标；bubbleOffset = 肖像可见顶部到气泡顶部的偏移 */
export const AVATAR = {
  box: 98,
  ring: { x: ringX, y: ringY, w: RING_W, h: RING_H },
  portrait: {
    x: ringX + RING_W * RING_CX - (RING_W * PORTRAIT_SCALE) / 2,
    y: ringY + RING_H * RING_CY - (RING_H * PORTRAIT_SCALE) / 2,
    w: RING_W * PORTRAIT_SCALE,
    h: RING_H * PORTRAIT_SCALE,
  },
  /** 头像盒顶部到气泡顶部的偏移 = 肖像顶部 + 3 */
  topToBubble: ringY + RING_H * RING_CY - (RING_H * PORTRAIT_SCALE) / 2 + 3,
} as const;

/** 气泡文本与 SVG 绘制参数 */
export const BUBBLE = {
  fontSize: 20.88,
  lineHeight: 20.88 * 1.5,
  padX: 13,
  padY: 9,
  minW: 51.76,
  minH: 42.47,
  /** 外框最大宽 / 内文最大宽 */
  maxW: 660,
  innerMaxW: 660 - 13 * 2,
  radius: 13.65,
  /** 尾巴占用的横向偏移：rect 从 x=8.2 开始，我方侧右边再留 8.2 */
  tailOffset: 8.2,
  /** 尾巴 path（对方侧原样；我方侧 translate(svgW) scale(-1,1) 镜像） */
  tailPath: 'M0,0s7.8,3.37,8.2,13.65S21.85,0,21.85,0H0Z',
  /** 单行气泡高 = 行高 + 上下内边距 */
  singleLineH: 20.88 * 1.5 + 9 * 2,
  /** 加载气泡 rect 宽（高 = singleLineH） */
  loadingW: 100,
  /** 加载气泡三个方块：边长 / 间距 */
  loadingDot: 8,
  loadingDotGap: 12,
} as const;

/** 底部输入面板：左右各比聊天框缩 2px，顶 = 框底 − 高 − 3 */
export const PANEL = {
  x: CHAT_FRAME_BOX.x + 2,
  w: CHAT_FRAME_BOX.w - 4,
  h: 80,
  y: CHAT_FRAME_BOX.y + CHAT_FRAME_BOX.h - 80 - 3,
  /** 面板上方渐隐遮罩条高 */
  edgeMaskH: 60,
  /** 顶部装饰图尺寸，距面板上端 5px 水平居中 */
  topDecoW: 1312,
  topDecoH: 16,
  topDecoGap: 5,
  /** 胶囊输入框与圆形按钮高、内容左右内边距、元素间距 */
  fieldH: 45,
  padX: 24,
  gap: 16,
} as const;

/** 表情弹层：紧贴面板顶边向上展开，与面板同宽 */
export const EMOJI_POP = {
  cols: 16,
  cell: 60,
  gap: 16,
  pad: 24,
} as const;

/** 右上角固定工具栏：从右到左 新建会话 / 对话管理 / 设置 */
export const TOOLBAR = {
  top: 44,
  rightStart: 60,
  step: 75,
  icon: 25,
} as const;
