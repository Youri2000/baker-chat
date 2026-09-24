/**
 * @file 29 个内置角色（名字、性别、本地头像 URL）与管理员头像，顺序与原项目 character.ts 一致，
 * 也是后端会话列表的角色排序依据。角色提示词只在后端，前端不持有。
 */

/** 角色性别；也决定子卡空态文案"和他/她聊聊" */
export type CharacterGender = 'male' | 'female';

/** 内置角色 */
export interface Character {
  name: string;
  gender: CharacterGender;
  /** Vite 处理后的头像 URL */
  avatar: string;
}

// 以 URL 形式一次性加载全部头像；key 形如 '/src/assets/avatars/梨诺.webp'
const avatarModules = import.meta.glob<string>('../assets/avatars/*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});

/** 按文件名（不含扩展名）取头像 URL */
function avatarOf(fileName: string): string {
  const key = Object.keys(avatarModules).find((k) => k.endsWith(`/${fileName}.webp`));
  // 头像文件在构建期由 glob 静态确定，缺失属于工程错误，直接抛出
  if (key === undefined) throw new Error(`头像缺失: ${fileName}`);
  return avatarModules[key];
}

/** 名字 + 性别的源表，头像 URL 由文件名派生 */
const SOURCE: ReadonlyArray<readonly [string, CharacterGender]> = [
  ['梨诺', 'female'],
  ['诀', 'female'],
  ['卡缪', 'male'],
  ['弭弗', 'female'],
  ['庄方宜', 'female'],
  ['洛茜', 'female'],
  ['汤汤', 'female'],
  ['伊冯', 'female'],
  ['洁尔佩塔', 'female'],
  ['莱万汀', 'female'],
  ['骏卫', 'male'],
  ['余烬', 'female'],
  ['别礼', 'female'],
  ['黎风', 'male'],
  ['艾尔黛拉', 'female'],
  ['佩丽卡', 'female'],
  ['陈千语', 'female'],
  ['狼卫', 'male'],
  ['弧光', 'female'],
  ['赛希', 'female'],
  ['阿列什', 'male'],
  ['大潘', 'male'],
  ['艾维文娜', 'female'],
  ['昼雪', 'female'],
  ['秋栗', 'female'],
  ['埃特拉', 'female'],
  ['卡契尔', 'male'],
  ['萤石', 'female'],
  ['安塔尔', 'male'],
];

/** 内置角色列表（内置顺序） */
export const CHARACTERS: readonly Character[] = SOURCE.map(([name, gender]) => ({
  name,
  gender,
  avatar: avatarOf(name),
}));

/** 按名字查角色；调用方传入的名字来自后端会话数据，必定存在 */
export function findCharacter(name: string): Character {
  const found = CHARACTERS.find((c) => c.name === name);
  if (found === undefined) throw new Error(`未知角色: ${name}`);
  return found;
}

/** 我方（管理员）头像，按设置里的 my_gender 选择 */
export const MINE_AVATARS: Readonly<Record<CharacterGender, string>> = {
  male: avatarOf('管理员_男'),
  female: avatarOf('管理员_女'),
};
