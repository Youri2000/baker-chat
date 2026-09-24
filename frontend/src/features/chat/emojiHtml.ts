/**
 * @file 表情 token 与输入框 HTML 的互转：emojiToHtml 把含 token 的文本转成含 <img data-emoji> 的 HTML
 * （ChatInput 用它向 contenteditable 插入表情）；htmlToEmojiText 把 contenteditable 的内容序列化回
 * 含 token 的纯文本（发送时用）。气泡渲染不走 HTML 字符串，直接用 constants/emoji 的 splitEmojiText。
 */
import { EMOJI_BY_TOKEN, EMOJI_TOKEN_RE } from '@/constants/emoji';

/** contenteditable 里会当作换行处理的块级标签（Chrome 的 insertText '\n' 可能产生 div） */
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'BLOCKQUOTE']);

/**
 * 文本 → HTML：先转义特殊字符，再把已登记的 token 替换成 <img>。
 * 图片高 1em、宽按原图宽高比（em），加载前即可参与布局；⚠️ preflight 把 img 设为 block，必须 inline-block。
 */
export function emojiToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(EMOJI_TOKEN_RE, (token) => {
    const emoji = EMOJI_BY_TOKEN.get(token);
    if (emoji === undefined) return token;
    return (
      `<img class="inline-block h-[1em] align-middle object-contain" data-emoji="${token}"` +
      ` src="${emoji.src}" alt="" style="width:${emoji.aspect}em" />`
    );
  });
}

/**
 * HTML → 文本：只保留文本节点与表情图（data-emoji → token），其余标签丢弃。
 * <br> 记为换行；块级元素在其内容前补一个换行，连续块级不产生空行。
 */
export function htmlToEmojiText(root: Element): string {
  let text = '';
  /** 在非空且不以换行结尾时补一个换行 */
  const pushNewline = () => {
    if (text !== '' && !text.endsWith('\n')) text += '\n';
  };
  /** 深度优先遍历 */
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLImageElement && node.dataset.emoji !== undefined) {
      text += node.dataset.emoji;
      return;
    }
    if (node.tagName === 'BR') {
      pushNewline();
      return;
    }
    if (BLOCK_TAGS.has(node.tagName)) pushNewline();
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return text;
}
