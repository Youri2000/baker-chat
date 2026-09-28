/**
 * @file 按需加载的等待反馈：屏幕中央三个方块闪烁，复用加载气泡的 loading-dot 动画与配色。
 * 从计时起点等待超过 SHOW_AFTER 才显示，代码很快到达时整个过程看不到任何闪烁。
 * 用作聊天页路由与设置对话框的 Suspense 兜底。
 */
import { useEffect, useState } from 'react';
import { BUBBLE } from '@/constants/design';

/** 等待超过多久才显示（ms） */
const SHOW_AFTER = 200;

/** PendingDots 属性 */
export interface PendingDotsProps {
  /** 计时起点（performance.now() 时间）；省略时从挂载时刻算起，0 表示从页面导航开始算起 */
  since?: number;
}

/** 延迟出现的加载动画 */
export function PendingDots({ since }: PendingDotsProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const start = since ?? performance.now();
    const timer = setTimeout(
      () => setVisible(true),
      Math.max(0, start + SHOW_AFTER - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [since]);

  if (!visible) return null;
  return (
    <div
      role="status"
      aria-label="加载中"
      className="fixed inset-0 z-[150] flex items-center justify-center text-loading-dot-other"
      style={{ gap: BUBBLE.loadingDotGap }}
    >
      {BUBBLE.loadingDotDelays.map((delay) => (
        <span
          key={delay}
          className="block animate-loading-dot bg-current"
          style={{
            width: BUBBLE.loadingDot,
            height: BUBBLE.loadingDot,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}
