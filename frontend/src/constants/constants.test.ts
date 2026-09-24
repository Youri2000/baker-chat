/**
 * @file 常量表测试：29 个角色顺序与头像、管理员头像、37 个表情的 token 与宽高比、token 切分。
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS, MINE_AVATARS, findCharacter } from '@/constants/characters';
import { EMOJIS, EMOJI_BY_TOKEN, splitEmojiText } from '@/constants/emoji';

describe('characters', () => {
  /** 数量与首尾顺序与原项目一致，每个角色都有头像 URL */
  it('包含 29 个角色且顺序正确', () => {
    expect(CHARACTERS).toHaveLength(29);
    expect(CHARACTERS[0].name).toBe('梨诺');
    expect(CHARACTERS[28].name).toBe('安塔尔');
    // 资源 URL 里的中文文件名是百分号编码的，先解码再比对
    expect(CHARACTERS.every((c) => decodeURIComponent(c.avatar).includes(`${c.name}.webp`))).toBe(
      true,
    );
  });

  /** 管理员男女头像各自指向对应文件 */
  it('提供管理员男女头像', () => {
    expect(decodeURIComponent(MINE_AVATARS.male)).toContain('管理员_男.webp');
    expect(decodeURIComponent(MINE_AVATARS.female)).toContain('管理员_女.webp');
  });

  /** 按名字查找 */
  it('findCharacter 返回性别', () => {
    expect(findCharacter('陈千语').gender).toBe('female');
  });
});

describe('emoji', () => {
  /** 37 个 token，按序号排列 */
  it('包含 37 个表情且 token 有序', () => {
    expect(EMOJIS).toHaveLength(37);
    expect(EMOJIS[0].token).toBe('[sns_emoji_001]');
    expect(EMOJIS[36].token).toBe('[sns_emoji_037]');
    expect(EMOJIS[36].src).toContain('sns_emoji_037.webp');
  });

  /** 横幅表情 032 按原图 60×26 计算宽高比，方形为 1 */
  it('宽高比来自原图尺寸表', () => {
    expect(EMOJI_BY_TOKEN.get('[sns_emoji_032]')?.aspect).toBeCloseTo(60 / 26);
    expect(EMOJI_BY_TOKEN.get('[sns_emoji_001]')?.aspect).toBe(1);
  });

  /** 文本切成 文本 | 表情 | 文本；未知 token 保留为文本 */
  it('splitEmojiText 切分文本与表情', () => {
    const parts = splitEmojiText('你好[sns_emoji_001]世界[sns_emoji_999]');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('你好');
    expect(parts[1]).toMatchObject({ token: '[sns_emoji_001]' });
    expect(parts[2]).toBe('世界[sns_emoji_999]');
  });
});
