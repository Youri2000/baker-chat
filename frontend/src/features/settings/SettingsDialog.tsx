/**
 * @file 设置对话框：六个标签页（AI 配置 / 世界观设定 / 角色提示词 / 数据管理 / 免责声明 / 关于）。
 * 外壳用 DialogShell 的 settings 变体（560px、限高 80vh）；选中的标签在开关之间保留（与原 SettingsDialog.vue 一致）。
 * 六个标签页同时挂载、非当前的用 hidden 隐藏，同一次打开内切换标签不会丢失各页自己持有的草稿；
 * 关闭对话框才卸载，下次打开从 store 重新同步。依赖 settings 的两个标签页在设置尚未加载时不渲染内容。
 */
import { useState } from 'react';
import { DialogShell } from '@/components/DialogShell';
import { AboutTab } from '@/features/settings/AboutTab';
import { AiConfigTab } from '@/features/settings/AiConfigTab';
import { CharacterPromptTab } from '@/features/settings/CharacterPromptTab';
import { DataManagerTab } from '@/features/settings/DataManagerTab';
import { DisclaimerTab } from '@/features/settings/DisclaimerTab';
import { WorldSettingTab } from '@/features/settings/WorldSettingTab';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 标签页定义，顺序即显示顺序 */
const TABS = [
  { key: 'api', label: 'AI 配置' },
  { key: 'world', label: '世界观设定' },
  { key: 'character', label: '角色提示词' },
  { key: 'data', label: '数据管理' },
  { key: 'disclaimer', label: '免责声明' },
  { key: 'about', label: '关于' },
] as const;

/** 标签键 */
type TabKey = (typeof TABS)[number]['key'];

/** SettingsDialog 属性 */
export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 设置对话框 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const settings = useSettingsStore((s) => s.settings);
  const [activeTab, setActiveTab] = useState<TabKey>('api');

  /** 某个标签页的内容 */
  function renderTab(key: TabKey) {
    switch (key) {
      case 'api':
        return settings === null ? null : <AiConfigTab settings={settings} />;
      case 'world':
        return settings === null ? null : <WorldSettingTab settings={settings} />;
      case 'character':
        return <CharacterPromptTab />;
      case 'data':
        return <DataManagerTab />;
      case 'disclaimer':
        return <DisclaimerTab />;
      case 'about':
        return <AboutTab />;
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title="设置" width={560} variant="settings">
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-text-primary/10">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === activeTab}
            data-active={tab.key === activeTab ? '' : undefined}
            className="cursor-pointer border-b-2 border-transparent px-4 py-2 text-[14px] text-text-primary/50 transition-all duration-(--anim-fast) hover:text-text-primary/80 data-active:border-accent data-active:text-text-primary"
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* 对应原 sd__body：在面板剩余高度内滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {TABS.map((tab) => (
          <div key={tab.key} role="tabpanel" hidden={tab.key !== activeTab}>
            {renderTab(tab.key)}
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
