/**
 * @file 设置数据层：设置项、角色提示词、统计、连接测试与数据管理批量操作。
 * 批量操作成功后同步 chatStore（删除全部对话 → reset；清空全部消息 → 丢弃缓存并重拉会话）并刷新统计。
 * 动作失败时自行 toast，不向调用方 reject。
 */
import { create } from 'zustand';
import { toastError } from '@/components/toastStore';
import { ApiError } from '@/lib/http';
import { useChatStore } from '@/features/chat/chatStore';
import {
  clearAllContext as apiClearAllContext,
  clearAllMessages as apiClearAllMessages,
  deleteAllConversations as apiDeleteAllConversations,
  getPrompts,
  getSettings,
  getStats,
  patchSettings,
  ping as apiPing,
  putPrompt,
  type CharacterPrompt,
  type PingResult,
  type Settings,
  type SettingsPatch,
  type Stats,
} from '@/features/settings/api';

/** 设置 store */
export interface SettingsState {
  /** 未加载为 null */
  settings: Settings | null;
  prompts: CharacterPrompt[];
  stats: Stats | null;

  loadSettings: () => Promise<void>;
  /** PATCH 后用响应替换 settings（我方头像性别、聊天条样式也走这里） */
  updateSettings: (patch: SettingsPatch) => Promise<void>;
  loadPrompts: () => Promise<void>;
  /** 保存单个角色的提示词覆盖并更新列表中的那一条 */
  savePrompt: (characterName: string, prompt: string) => Promise<void>;
  loadStats: () => Promise<void>;
  /** 连接测试；请求本身失败也归为 ok:false */
  ping: () => Promise<PingResult>;
  deleteAllConversations: () => Promise<void>;
  clearAllMessages: () => Promise<void>;
  clearAllContext: () => Promise<void>;
}

/** 设置数据层 */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  prompts: [],
  stats: null,

  loadSettings: async () => {
    try {
      set({ settings: await getSettings() });
    } catch (err) {
      toastError(err);
    }
  },

  updateSettings: async (patch) => {
    try {
      set({ settings: await patchSettings(patch) });
    } catch (err) {
      toastError(err);
    }
  },

  loadPrompts: async () => {
    try {
      set({ prompts: await getPrompts() });
    } catch (err) {
      toastError(err);
    }
  },

  savePrompt: async (characterName, prompt) => {
    try {
      const saved = await putPrompt(characterName, prompt);
      set((s) => ({
        prompts: s.prompts.map((p) => (p.character_name === characterName ? saved : p)),
      }));
    } catch (err) {
      toastError(err);
    }
  },

  loadStats: async () => {
    try {
      set({ stats: await getStats() });
    } catch (err) {
      toastError(err);
    }
  },

  ping: async () => {
    try {
      return await apiPing();
    } catch (err) {
      return {
        ok: false,
        model: get().settings?.model ?? '',
        error: err instanceof ApiError ? err.detail : '网络错误，请稍后重试',
      };
    }
  },

  deleteAllConversations: async () => {
    try {
      await apiDeleteAllConversations();
    } catch (err) {
      toastError(err);
      return;
    }
    await Promise.all([useChatStore.getState().reset(), get().loadStats()]);
  },

  clearAllMessages: async () => {
    try {
      await apiClearAllMessages();
    } catch (err) {
      toastError(err);
      return;
    }
    useChatStore.getState().forgetMessages();
    await Promise.all([useChatStore.getState().loadConversations(), get().loadStats()]);
  },

  clearAllContext: async () => {
    try {
      await apiClearAllContext();
    } catch (err) {
      toastError(err);
    }
  },
}));
