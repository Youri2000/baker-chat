/**
 * @file 设置、角色提示词、AI 连接测试、数据管理接口（docs/api.md §4–§6）。
 */
import { http } from '@/lib/http';

/** 用户设置；model / daily_* 只读 */
export interface Settings {
  temperature: number;
  max_tokens: number;
  /** 生效的世界观文本（空串已被后端替换为默认值） */
  world_setting: string;
  world_setting_is_default: boolean;
  my_gender: 'male' | 'female';
  strip_variant: 0 | 1 | 2;
  model: string;
  daily_limit: number;
  daily_used: number;
}

/** 可修改的字段；world_setting 传空串表示恢复默认 */
export type SettingsPatch = Partial<
  Pick<Settings, 'temperature' | 'max_tokens' | 'world_setting' | 'my_gender' | 'strip_variant'>
>;

/** 角色提示词 */
export interface CharacterPrompt {
  character_name: string;
  /** 生效文本：覆盖值或内置值 */
  prompt: string;
  is_custom: boolean;
}

/** 数据统计 */
export interface Stats {
  characters: number;
  conversations_with_content: number;
  messages: number;
}

/** 连接测试结果 */
export type PingResult = { ok: true; model: string } | { ok: false; model: string; error: string };

/** 当前设置 */
export function getSettings(): Promise<Settings> {
  return http<Settings>('/settings');
}

/** 部分更新，返回完整设置 */
export function patchSettings(patch: SettingsPatch): Promise<Settings> {
  return http<Settings>('/settings', { method: 'PATCH', body: patch });
}

/** 29 条角色提示词，按内置顺序 */
export function getPrompts(): Promise<CharacterPrompt[]> {
  return http<CharacterPrompt[]>('/prompts');
}

/** 保存覆盖；空串或与内置相同时后端删除覆盖记录 */
export function putPrompt(characterName: string, prompt: string): Promise<CharacterPrompt> {
  return http<CharacterPrompt>(`/prompts/${encodeURIComponent(characterName)}`, {
    method: 'PUT',
    body: { prompt },
  });
}

/** 后端向上游发一次最小请求 */
export function ping(): Promise<PingResult> {
  return http<PingResult>('/ai/ping');
}

/** 统计 */
export function getStats(): Promise<Stats> {
  return http<Stats>('/data/stats');
}

/** 每个角色只保留一个新的空会话 */
export function deleteAllConversations(): Promise<void> {
  return http<void>('/data/delete-all-conversations', { method: 'POST' });
}

/** 清空全部可见消息 */
export function clearAllMessages(): Promise<void> {
  return http<void>('/data/clear-all-messages', { method: 'POST' });
}

/** 清空全部 AI 上下文 */
export function clearAllContext(): Promise<void> {
  return http<void>('/data/clear-all-context', { method: 'POST' });
}
