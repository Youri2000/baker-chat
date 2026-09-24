/**
 * @file 1920×1080 设计画布：按 min(innerWidth/1920, innerHeight/1080) 用 CSS zoom 等比缩放并居中；resize 用 rAF 节流。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { DESIGN_H, DESIGN_W } from '@/constants/design';

/**
 * 当前视口对应的缩放系数。
 * 💡 用 zoom 而非 transform: scale：zoom 参与布局，居中只需 flex，ResizeObserver / offsetWidth 量到的仍是
 * 未缩放的 CSS px，文字选择与命中测试也不受影响，详见 docs/interview.md#zoom-canvas
 */
function computeZoom(): number {
  return Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
}

/** DesignCanvas 属性 */
export interface DesignCanvasProps {
  children: ReactNode;
}

/** 等比缩放画布容器 */
export function DesignCanvas({ children }: DesignCanvasProps) {
  const [zoom, setZoom] = useState(computeZoom);

  useEffect(() => {
    let raf = 0;
    /** 同一帧内多次 resize 只计算一次 */
    const handleResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setZoom(computeZoom()));
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-1 flex items-center justify-center">
      <div
        data-testid="design-canvas"
        className="relative flex-none overflow-hidden"
        style={{ width: DESIGN_W, height: DESIGN_H, zoom }}
      >
        {children}
      </div>
    </div>
  );
}
