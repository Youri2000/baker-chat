/**
 * @file 对话管理对话框（原 DeleteConfirmDialog.vue）：针对当前选中的会话提供删除对话 / 清空消息 /
 * 清空上下文，每个操作先进确认页。未选中会话时只显示提示文案；该角色只剩一个会话时删除按钮禁用。
 * 外壳用 DialogShell（348px，原 dialog-shell(dc) 的标题下边距 10px），动作走 chatStore，失败由 store 内部 toast。
 */
import { useState } from 'react';
import { DialogButton } from '@/components/DialogButton';
import { DialogShell } from '@/components/DialogShell';
import { useChatStore } from '@/features/chat/chatStore';

/** 待确认的操作 */
type Action = 'delete' | 'clearMessages' | 'clearContext';

/** 确认页文案 */
const CONFIRM_TEXTS: Record<Action, string> = {
  delete: '确认删除这个会话？',
  clearMessages: '确认清空当前对话的消息？(AI 记忆保留)',
  clearContext: '确认清空当前对话的上下文？(消息保留)',
};

/** DeleteConfirmDialog 属性 */
export interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 对话管理对话框 */
export function DeleteConfirmDialog({ open, onClose }: DeleteConfirmDialogProps) {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const clearContext = useChatStore((s) => s.clearContext);
  const [action, setAction] = useState<Action | null>(null);

  const active = conversations.find((c) => c.id === activeConversationId);
  // 每个角色至少保留一个会话（后端 409），只剩一个时直接禁用
  const canDelete =
    active !== undefined &&
    conversations.filter((c) => c.character_name === active.character_name).length > 1;

  /** 关闭并回到主菜单，下次打开不会停在确认页 */
  function close() {
    setAction(null);
    onClose();
  }

  /** 确认：先关闭对话框再执行，与原组件一致 */
  async function handleConfirm(kind: Action, id: number) {
    close();
    if (kind === 'delete') await deleteConversation(id);
    else if (kind === 'clearMessages') await clearMessages(id);
    else await clearContext(id);
  }

  return (
    <DialogShell open={open} onClose={close} title="对话管理" titleGap={10}>
      {active === undefined ? (
        <p className="mb-[18px] text-[15px] text-subcard-text">
          请先在左侧选中一段对话，再进行操作。
        </p>
      ) : action !== null ? (
        <div>
          <p className="mb-[14px] text-[15px] text-subcard-text">{CONFIRM_TEXTS[action]}</p>
          <div className="flex gap-3">
            <DialogButton variant="primary" onClick={() => void handleConfirm(action, active.id)}>
              确认
            </DialogButton>
            <DialogButton onClick={() => setAction(null)}>取消</DialogButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <DialogButton
            variant="danger"
            disabled={!canDelete}
            title={canDelete ? undefined : '该角色只剩这一个会话，无法删除'}
            onClick={() => setAction('delete')}
          >
            删除对话
          </DialogButton>
          <DialogButton onClick={() => setAction('clearMessages')}>清空消息</DialogButton>
          <DialogButton onClick={() => setAction('clearContext')}>清空上下文</DialogButton>
        </div>
      )}
    </DialogShell>
  );
}
