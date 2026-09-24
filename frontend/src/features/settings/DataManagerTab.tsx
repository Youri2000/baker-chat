/**
 * @file 设置 › 数据管理（原 DataManagerDialog.vue 的内嵌模式）：统计行 + 三个全局操作，
 * 删除全部对话 / 清空全部消息 / 清空全部上下文都先切到确认页再执行。
 * 按钮沿用 dialog-shell 的胶囊样式（DialogButton）；统计由 settingsStore.loadStats 在挂载时拉取。
 */
import { useEffect, useState } from 'react';
import { DialogButton } from '@/components/DialogButton';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 待确认的操作 */
type ConfirmKind = 'deleteAll' | 'clearMessages' | 'clearContext';

/** 确认页文案 */
const CONFIRM_TEXTS: Record<ConfirmKind, string> = {
  deleteAll: '将删除全部对话，确定吗？',
  clearMessages: '将清空全部对话的消息（上下文记忆保留），确定吗？',
  clearContext: '将清空全部对话的上下文（消息记录保留），确定吗？',
};

/** 数据管理标签页 */
export function DataManagerTab() {
  const stats = useSettingsStore((s) => s.stats);
  const loadStats = useSettingsStore((s) => s.loadStats);
  const deleteAllConversations = useSettingsStore((s) => s.deleteAllConversations);
  const clearAllMessages = useSettingsStore((s) => s.clearAllMessages);
  const clearAllContext = useSettingsStore((s) => s.clearAllContext);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  /** 执行已确认的操作并回到主页面；store 动作成功后自行刷新统计 */
  async function handleConfirm(kind: ConfirmKind) {
    setConfirm(null);
    if (kind === 'deleteAll') await deleteAllConversations();
    else if (kind === 'clearMessages') await clearAllMessages();
    else await clearAllContext();
  }

  return (
    <div className="flex flex-col">
      <p className="mb-[18px] text-[15px] text-subcard-text">
        {stats === null
          ? '统计加载中…'
          : `干员 ${stats.characters} · 对话 ${stats.conversations_with_content} · 消息 ${stats.messages}`}
      </p>
      {confirm !== null ? (
        <div>
          <p className="mb-[14px] text-[16px] text-subcard-text">{CONFIRM_TEXTS[confirm]}</p>
          <div className="flex gap-3">
            <DialogButton variant="primary" onClick={() => void handleConfirm(confirm)}>
              确认
            </DialogButton>
            <DialogButton onClick={() => setConfirm(null)}>取消</DialogButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <DialogButton variant="danger" onClick={() => setConfirm('deleteAll')}>
            删除全部对话
          </DialogButton>
          <DialogButton onClick={() => setConfirm('clearMessages')}>清空全部消息</DialogButton>
          <DialogButton onClick={() => setConfirm('clearContext')}>清空全部上下文</DialogButton>
        </div>
      )}
    </div>
  );
}
