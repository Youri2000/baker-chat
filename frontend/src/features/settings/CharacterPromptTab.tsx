/**
 * @file 设置 › 角色提示词：下拉选择 29 个角色之一编辑其提示词，已覆盖的角色显示"已自定义"徽标。
 * 打开时默认选中当前会话的角色；保存空内容或"恢复默认"都把空串 PUT 给后端以删除覆盖记录。
 * 提示词列表来自 settingsStore.prompts，挂载时拉取。
 */
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { CHARACTERS } from '@/constants/characters';
import { useChatStore } from '@/features/chat/chatStore';
import { CONTROL_CLASS } from '@/features/settings/controlClass';
import { SettingsButton } from '@/features/settings/SettingsButton';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 当前会话所属的角色名；没有选中会话则为空串（对应下拉框的"选择角色…"） */
function activeConversationCharacter(): string {
  const { activeConversationId, conversations } = useChatStore.getState();
  return conversations.find((c) => c.id === activeConversationId)?.character_name ?? '';
}

/** 角色提示词标签页 */
export function CharacterPromptTab() {
  const prompts = useSettingsStore((s) => s.prompts);
  const loadPrompts = useSettingsStore((s) => s.loadPrompts);
  const savePrompt = useSettingsStore((s) => s.savePrompt);
  const [selected, setSelected] = useState(activeConversationCharacter);
  // 💡 草稿为 null 表示"未编辑"，textarea 直接显示 store 里的生效文本；换角色 / 保存后置回 null，
  // 不需要 effect 去同步 props → state，详见 docs/interview.md#settings-draft
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const current = prompts.find((p) => p.character_name === selected);
  const value = draft ?? current?.prompt ?? '';

  /** 保存后回到"未编辑"，显示后端返回的生效文本 */
  async function submit(prompt: string) {
    await savePrompt(selected, prompt);
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          aria-label="角色"
          value={selected}
          className={clsx(
            CONTROL_CLASS,
            'cursor-pointer px-3 py-2 text-[14px] [&>option]:bg-card-bg',
          )}
          onChange={(e) => {
            setSelected(e.target.value);
            setDraft(null);
          }}
        >
          <option value="" disabled>
            选择角色…
          </option>
          {CHARACTERS.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        {current?.is_custom === true && (
          <span className="rounded border border-accent/30 bg-accent/15 px-2 py-0.5 text-[12px] whitespace-nowrap text-accent">
            已自定义
          </span>
        )}
      </div>
      <textarea
        aria-label="角色提示词"
        rows={16}
        disabled={selected === ''}
        placeholder={selected === '' ? '请先在左侧选择一个角色' : '输入角色提示词…'}
        value={value}
        className={clsx(
          CONTROL_CLASS,
          'min-h-[320px] w-full resize-y px-3 py-2.5 text-[13px] leading-[1.6] disabled:cursor-not-allowed disabled:opacity-40',
        )}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1 flex gap-2">
        <SettingsButton
          variant="primary"
          disabled={selected === ''}
          onClick={() => void submit(value)}
        >
          保存
        </SettingsButton>
        <SettingsButton disabled={selected === ''} onClick={() => void submit('')}>
          恢复默认
        </SettingsButton>
      </div>
    </div>
  );
}
