/**
 * @file 会话与消息接口（docs/api.md §2–§3）。AI 对话流不在这里，由 chatStore 直接调 lib/sse；
 * 停止生成的 POST 接口在这里。
 */
import { http } from '@/lib/http';

/** 消息方向：mine = 管理员（用户），other = 角色（AI） */
export type MessageSide = 'mine' | 'other';

/** 会话（一张子卡） */
export interface Conversation {
  id: number;
  character_name: string;
  /** 子卡预览用的最后一条消息 */
  last_message: { side: MessageSide; text: string } | null;
  created_at: string;
  updated_at: string;
}

/** 持久化的消息 */
export interface Message {
  id: number;
  side: MessageSide;
  /** 可含 \n 与 [sns_emoji_NNN] token */
  text: string;
  status: 'completed' | 'aborted' | 'failed';
  created_at: string;
}

/** 全部会话：按角色内置顺序，再按创建时间 */
export function getConversations(): Promise<Conversation[]> {
  return http<Conversation[]>('/conversations');
}

/** 为角色新建空会话 */
export function createConversation(characterName: string): Promise<Conversation> {
  return http<Conversation>('/conversations', {
    method: 'POST',
    body: { character_name: characterName },
  });
}

/** 删除会话：409 该角色至少保留一个会话 */
export function deleteConversation(id: number): Promise<void> {
  return http<void>(`/conversations/${id}`, { method: 'DELETE' });
}

/** 某会话的全部消息，按 id 升序 */
export function getMessages(id: number): Promise<Message[]> {
  return http<Message[]>(`/conversations/${id}/messages`);
}

/** 只清可见消息，AI 上下文保留 */
export function clearMessages(id: number): Promise<void> {
  return http<void>(`/conversations/${id}/messages/clear`, { method: 'POST' });
}

/** 只清 AI 上下文，消息保留 */
export function clearContext(id: number): Promise<void> {
  return http<void>(`/conversations/${id}/context/clear`, { method: 'POST' });
}

/** 停止该会话正在进行的回复；返回时服务端已按中断规则落库。没有活动流时 stopped 为 false */
export function stopChat(id: number): Promise<{ stopped: boolean }> {
  return http<{ stopped: boolean }>(`/conversations/${id}/chat/stop`, { method: 'POST' });
}
