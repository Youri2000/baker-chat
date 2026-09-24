/**
 * @file 设置 › 世界观设定：textarea 编辑所有角色共享的世界观，保存 / 恢复默认。
 * 恢复默认 = PATCH world_setting 为空串，后端回填默认文本；保存后草稿与 store 的生效文本重新对齐。
 */
import clsx from 'clsx';
import { useState } from 'react';
import { CONTROL_CLASS } from '@/features/settings/controlClass';
import { SettingsButton } from '@/features/settings/SettingsButton';
import type { Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** WorldSettingTab 属性 */
export interface WorldSettingTabProps {
  /** 已加载的设置，草稿的初始值 */
  settings: Settings;
}

/** 世界观设定标签页 */
export function WorldSettingTab({ settings }: WorldSettingTabProps) {
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [draft, setDraft] = useState(settings.world_setting);

  /** 提交后用 store 里的生效文本刷新草稿（空串保存会被后端替换成默认世界观） */
  async function submit(worldSetting: string) {
    await updateSettings({ world_setting: worldSetting });
    const saved = useSettingsStore.getState().settings;
    if (saved !== null) setDraft(saved.world_setting);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="mb-1 text-[13px] leading-normal text-text-primary/50">
        世界观设定，所有角色对话共享。
      </p>
      <textarea
        aria-label="世界观设定"
        rows={6}
        placeholder="输入世界观设定..."
        value={draft}
        className={clsx(CONTROL_CLASS, 'w-full resize-y px-3 py-2.5 text-[13px] leading-[1.6]')}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1 flex gap-2">
        <SettingsButton variant="primary" onClick={() => void submit(draft)}>
          保存
        </SettingsButton>
        <SettingsButton onClick={() => void submit('')}>恢复默认</SettingsButton>
      </div>
    </div>
  );
}
