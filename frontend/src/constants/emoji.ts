/**
 * @file 表情表：37 个 `[sns_emoji_NNN]` token、图片 URL 与原图宽高比，供气泡、子卡预览、
 * 表情弹层共用。消息文本里只存 token，渲染成 <img> 由消费方完成（注意 preflight 把 img 设为块级，要显式 inline）。
 */

/** 单个表情 */
export interface Emoji {
  /** 文本 token，如 '[sns_emoji_001]' */
  token: string;
  /** 图片 URL */
  src: string;
  /** 宽高比（宽/高）；高度 1em 时宽度 = aspect em */
  aspect: number;
}

// ?no-inline：37 张小图作为独立文件按需加载，不 base64 内联进主包
const emojiModules = import.meta.glob<string>('../assets/emojis/*.webp', {
  eager: true,
  import: 'default',
  query: '?no-inline',
});

/** 非方形表情的原图尺寸（宽×高，px）；未列出的为 60×60 */
export const EMOJI_NATURAL: Readonly<Record<number, readonly [number, number]>> = {
  9: [62, 60],
  18: [62, 60],
  30: [47, 43],
  31: [44, 46],
  32: [60, 26],
  33: [44, 52],
  34: [57, 56],
  35: [36, 50],
  36: [52, 38],
  37: [46, 48],
};

/** 从 glob key 取序号：'/…/sns_emoji_007.webp' → 7 */
function numberOf(path: string): number {
  return Number(/sns_emoji_(\d+)\.webp$/.exec(path)?.[1]);
}

/** 表情列表，按序号 001 → 037 */
export const EMOJIS: readonly Emoji[] = Object.keys(emojiModules)
  .sort((a, b) => numberOf(a) - numberOf(b))
  .map((path) => {
    const num = numberOf(path);
    const [w, h] = EMOJI_NATURAL[num] ?? [60, 60];
    return {
      token: `[sns_emoji_${String(num).padStart(3, '0')}]`,
      src: emojiModules[path],
      aspect: w / h,
    };
  });

/** token → 表情 */
export const EMOJI_BY_TOKEN: ReadonlyMap<string, Emoji> = new Map(EMOJIS.map((e) => [e.token, e]));

/** 匹配文本中的表情 token（全局，带捕获组） */
export const EMOJI_TOKEN_RE = /\[sns_emoji_\d{3}\]/g;

/**
 * 把含 token 的文本切成"纯文本片段 | 表情"序列，供渲染成 React 节点。
 * 未登记的 token 原样保留为文本。
 */
export function splitEmojiText(text: string): Array<string | Emoji> {
  const parts: Array<string | Emoji> = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_TOKEN_RE)) {
    const emoji = EMOJI_BY_TOKEN.get(match[0]);
    if (emoji === undefined) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(emoji);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
