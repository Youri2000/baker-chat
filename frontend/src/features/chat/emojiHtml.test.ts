/**
 * @file 表情互转测试：token → <img> 的转义与尺寸、<img>/<br>/<div> → 文本、往返一致。
 */
import { describe, expect, it } from 'vitest';
import { EMOJIS } from '@/constants/emoji';
import { emojiToHtml, htmlToEmojiText } from '@/features/chat/emojiHtml';

/** 把 HTML 装进容器供 htmlToEmojiText 遍历 */
function container(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('emojiToHtml', () => {
  /** token 变成带 data-emoji 与 em 尺寸的 inline 图片，文本原样保留 */
  it('把 token 渲染成 inline <img>', () => {
    const div = container(emojiToHtml('你好[sns_emoji_001]世界'));
    const img = div.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.dataset.emoji).toBe('[sns_emoji_001]');
    expect(img?.getAttribute('src')).toBe(EMOJIS[0].src);
    expect(img?.style.width).toBe('1em');
    expect(img?.className).toContain('inline-block');
    expect(div.textContent).toBe('你好世界');
  });

  /** 横幅表情 032（60×26）宽度按宽高比 */
  it('非方形表情按原图宽高比设置宽度', () => {
    const img = container(emojiToHtml('[sns_emoji_032]')).querySelector('img');
    expect(img?.style.width).toBe(`${60 / 26}em`);
  });

  /** 特殊字符转义、未登记 token 保留为文本 */
  it('转义 HTML 并保留未知 token', () => {
    const div = container(emojiToHtml('<b>&"[sns_emoji_999]'));
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent).toBe('<b>&"[sns_emoji_999]');
  });
});

describe('htmlToEmojiText', () => {
  /** 表情图片还原为 token，其他标签只保留文本 */
  it('把 <img data-emoji> 还原为 token', () => {
    const html = '你好<img data-emoji="[sns_emoji_003]" src="x" alt="">世界<span>!</span>';
    expect(htmlToEmojiText(container(html))).toBe('你好[sns_emoji_003]世界!');
  });

  /** <br> 与块级 div 都记为换行，连续块级不产生空行 */
  it('把 <br> 与块级元素转成换行', () => {
    expect(htmlToEmojiText(container('第一行<br>第二行'))).toBe('第一行\n第二行');
    expect(htmlToEmojiText(container('第一行<div>第二行</div><div>第三行</div>'))).toBe(
      '第一行\n第二行\n第三行',
    );
    expect(htmlToEmojiText(container('<div>只有一行</div>'))).toBe('只有一行');
  });

  /** 往返一致 */
  it('emojiToHtml → htmlToEmojiText 保持原文', () => {
    const text = '在吗[sns_emoji_010]\n再见[sns_emoji_037]';
    expect(htmlToEmojiText(container(emojiToHtml(text)))).toBe(text);
  });
});
