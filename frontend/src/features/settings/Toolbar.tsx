/**
 * @file 右上角固定工具栏（原 App.vue 的 edit-toggle 按钮组）：从右到左 新建会话 / 对话管理 / 设置，
 * 以及它们打开的三个对话框（"请先选中角色卡片"提示、对话管理、设置）。
 * 位于 DesignCanvas 之外（fixed，不随画布缩放）；E 键切换按钮组显隐，对话框不受影响。
 */
import { useEffect, useState } from 'react';
import { DialogButton } from '@/components/DialogButton';
import { DialogShell } from '@/components/DialogShell';
import { TOOLBAR } from '@/constants/design';
import { MATERIALS } from '@/constants/materials';
import { useChatStore } from '@/features/chat/chatStore';
import { DeleteConfirmDialog } from '@/features/settings/DeleteConfirmDialog';
import { SettingsDialog } from '@/features/settings/SettingsDialog';

/** 当前打开的对话框 */
type OpenDialog = 'needSelect' | 'manage' | 'settings' | null;

/** 按钮：fixed、无边框透明底；图标 25px 半透明，hover 时染成 #999898 灰 */
const BUTTON_CLASS = 'group fixed z-[100] cursor-pointer p-0';
const ICON_CLASS =
  'block h-auto opacity-50 group-hover:[filter:brightness(0)_invert(1)_brightness(0.6)]';

/** 焦点在输入框 / textarea / contenteditable 内时按键属于输入，不切换工具栏 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

/** 工具栏 */
export function Toolbar() {
  const activeCharacterName = useChatStore((s) => s.activeCharacterName);
  const createConversation = useChatStore((s) => s.createConversation);
  // 仅会话内生效，刷新即恢复可见
  const [visible, setVisible] = useState(true);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  useEffect(() => {
    /** ✅ E 键切换显隐；带 Ctrl / Meta / Alt 的组合键不算 */
    function handleKeydown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'e') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      setVisible((v) => !v);
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, []);

  /** 新建会话：已选中主卡就在该角色下新增并选中，否则提示先选角色 */
  function handleNew() {
    if (activeCharacterName === null) {
      setDialog('needSelect');
      return;
    }
    void createConversation(activeCharacterName);
  }

  /** 关闭当前对话框 */
  function closeDialog() {
    setDialog(null);
  }

  return (
    <>
      {visible && (
        <>
          <button
            type="button"
            aria-label="新建会话"
            className={BUTTON_CLASS}
            style={{ top: TOOLBAR.top, right: TOOLBAR.rightStart }}
            onClick={handleNew}
          >
            <img
              className={ICON_CLASS}
              style={{ width: TOOLBAR.icon }}
              src={MATERIALS.editBtnChat09}
              alt=""
            />
          </button>
          <button
            type="button"
            aria-label="对话管理"
            className={BUTTON_CLASS}
            style={{ top: TOOLBAR.top, right: TOOLBAR.rightStart + TOOLBAR.step }}
            onClick={() => setDialog('manage')}
          >
            <img
              className={ICON_CLASS}
              style={{ width: TOOLBAR.icon }}
              src={MATERIALS.editBtnDeleteIndeed}
              alt=""
            />
          </button>
          <button
            type="button"
            aria-label="设置"
            className={BUTTON_CLASS}
            style={{ top: TOOLBAR.top, right: TOOLBAR.rightStart + TOOLBAR.step * 2 }}
            onClick={() => setDialog('settings')}
          >
            <img
              className={ICON_CLASS}
              style={{ width: TOOLBAR.icon }}
              src={MATERIALS.loginBtnSetting}
              alt=""
            />
          </button>
        </>
      )}

      {/* "请先选中角色卡片"：原 dialog-shell(ns, 280px, 0)，无标题、文案居中、按钮居中 */}
      <DialogShell open={dialog === 'needSelect'} onClose={closeDialog} width={280}>
        <p className="mb-[18px] text-center text-[16px] text-text-primary">请先选中角色卡片</p>
        <DialogButton className="mx-auto block" onClick={closeDialog}>
          确定
        </DialogButton>
      </DialogShell>
      <DeleteConfirmDialog open={dialog === 'manage'} onClose={closeDialog} />
      <SettingsDialog open={dialog === 'settings'} onClose={closeDialog} />
    </>
  );
}
