/**
 * @file 按需加载的聊天页：入口在挂载前预取、登录与注册页渲染后预取、路由渲染时共用同一次下载。
 * 聊天页及其依赖（chatStore、settingsStore、角色列表、虚拟列表库等）因此都不进入入口 chunk。
 */
import { lazyWithPreload } from '@/components/lazyWithPreload';

/** 聊天页：ChatPageLoader.Component 渲染，ChatPageLoader.preload() 预取 */
export const ChatPageLoader = lazyWithPreload(() =>
  import('@/features/chat/ChatPage').then((m) => m.ChatPage),
);
