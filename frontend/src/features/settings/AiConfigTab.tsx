/**
 * @file 设置 › AI 配置：温度滑块、最大 Token 数、只读的模型名与今日剩余额度，
 * 保存 / 连接测试 / 恢复默认。草稿在挂载时从 settings 同步，保存走 settingsStore.updateSettings。
 * 挂载时重新拉一次设置，让"今日剩余额度"反映最新发送数。
 */
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { CONTROL_CLASS } from '@/features/settings/controlClass';
import { SettingsButton } from '@/features/settings/SettingsButton';
import type { PingResult, Settings } from '@/features/settings/api';
import { useSettingsStore } from '@/features/settings/settingsStore';

/** 后端默认值（docs/api.md §4） */
const DEFAULT_TEMPERATURE = 0.8;
const DEFAULT_MAX_TOKENS = 2048;
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 8192;

/** 字段标签：13px、60% 白 */
const LABEL_CLASS = 'text-text-primary/60 text-[13px]';

/** 连接测试的三种状态 */
type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done'; result: PingResult };

/** 把输入框文本收敛到 1–8192 的整数；用户输入是真实边界，越界值不交给后端 422 */
function clampMaxTokens(raw: string): number {
  const n = Math.round(Number(raw));
  if (Number.isNaN(n)) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, n));
}

/** AiConfigTab 属性 */
export interface AiConfigTabProps {
  /** 已加载的设置，草稿的初始值 */
  settings: Settings;
}

/** AI 配置标签页 */
export function AiConfigTab({ settings }: AiConfigTabProps) {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const ping = useSettingsStore((s) => s.ping);
  const [temperature, setTemperature] = useState(settings.temperature);
  // number 输入框的中间态（如清空后）保留为字符串，保存时再解析
  const [maxTokens, setMaxTokens] = useState(String(settings.max_tokens));
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /** 保存温度与最大 Token */
  async function handleSave() {
    await updateSettings({ temperature, max_tokens: clampMaxTokens(maxTokens) });
  }

  /** 恢复默认：草稿与后端一起回到 0.8 / 2048 */
  async function handleReset() {
    setTemperature(DEFAULT_TEMPERATURE);
    setMaxTokens(String(DEFAULT_MAX_TOKENS));
    await updateSettings({ temperature: DEFAULT_TEMPERATURE, max_tokens: DEFAULT_MAX_TOKENS });
  }

  /** 连接测试：后端向上游发一次最小请求 */
  async function handleTest() {
    setTest({ kind: 'testing' });
    setTest({ kind: 'done', result: await ping() });
  }

  const remaining = settings.daily_limit - settings.daily_used;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>温度 ({temperature.toFixed(1)})</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          className="w-full accent-accent"
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>最大 Token 数</span>
        <input
          type="number"
          min={MAX_TOKENS_MIN}
          max={MAX_TOKENS_MAX}
          value={maxTokens}
          className={clsx(CONTROL_CLASS, 'px-3 py-2 text-[14px]')}
          onChange={(e) => setMaxTokens(e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>模型</span>
        <span className="text-[14px] text-text-primary">{settings.model}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>今日剩余额度</span>
        <span className="text-[14px] text-text-primary">
          {remaining} / {settings.daily_limit}
        </span>
      </div>
      <div className="mt-1 flex gap-2">
        <SettingsButton variant="primary" onClick={() => void handleSave()}>
          保存
        </SettingsButton>
        <SettingsButton disabled={test.kind === 'testing'} onClick={() => void handleTest()}>
          {test.kind === 'testing' ? '测试中...' : '连接测试'}
        </SettingsButton>
        <SettingsButton onClick={() => void handleReset()}>恢复默认</SettingsButton>
      </div>
      {test.kind === 'done' &&
        (test.result.ok ? (
          <p role="status" className="text-[13px] text-[rgba(100,255,100,0.7)]">
            连接成功
          </p>
        ) : (
          <p role="status" className="text-[13px] text-[rgba(255,180,80,0.8)]">
            连接失败：{test.result.error}
          </p>
        ))}
    </div>
  );
}
