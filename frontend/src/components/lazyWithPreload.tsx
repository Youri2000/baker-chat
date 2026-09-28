/**
 * @file 可预取的懒加载组件：聊天页（入口挂载前预取）与设置对话框（聊天页挂载后预取）共用。
 * React.lazy 第一次渲染总会挂起一次（模块 Promise 要等微任务才兑现），首次挂载、点击这类同步更新里一挂起就会提交
 * Suspense 兜底，而 React 19 让兜底至少停留 300ms——只靠提前 import 仍会慢 300ms。
 * 这里在模块已经预取到时直接渲染真实组件；只有代码确实还没到时才走 lazy，由外层 Suspense 显示兜底。
 * 💡 实测只开 React.lazy 时已登录刷新从约 26ms 变成约 335ms，详见 docs/interview.md#lazy-preload
 */
import { lazy, useState, type ComponentType } from 'react';

/** 可预取的懒加载组件 */
export interface PreloadableComponent<P extends object> {
  /** 渲染入口：代码已到直接渲染真实组件，否则挂起（需要外层 Suspense） */
  Component: ComponentType<P>;
  /** 开始下载代码；多次调用共用同一次下载 */
  preload: () => Promise<ComponentType<P>>;
}

/** 用加载函数创建可预取的懒加载组件 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>,
): PreloadableComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  /** 下载一次并记下结果 */
  function preload(): Promise<ComponentType<P>> {
    pending ??= load().then((component) => (loaded = component));
    return pending;
  }

  const Lazy = lazy(() => preload().then((component) => ({ default: component })));

  /** 渲染入口 */
  function Component(props: P) {
    // ⚠️ 挂载时决定走哪条路并固定下来：中途从 Lazy 换成真实组件会让组件类型改变、状态丢失
    const [Loaded] = useState(() => loaded);
    return Loaded === null ? <Lazy {...props} /> : <Loaded {...props} />;
  }

  return { Component, preload };
}
