# 聊天区（chat）

记录实现 `frontend/src/features/chat/`（聊天条、聊天框、消息流、SVG 气泡、头像、加载气泡、输入面板、表情弹层，以及 chatStore 的中断语义）时的选型、问题与实测数据。日期 2026-09-24。

## 1. 技术选型

| 项目                 | 候选                                                                                                                                                                                           | 放弃理由                                                                                                                                                                                                                                                                                            | 结论                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 气泡尺寸测量         | ① canvas `measureText` + 隐藏 ruler DOM 取大值（原项目 `utils/measure.ts`）② `useLayoutEffect` 里读 `offsetWidth` / `getBoundingClientRect` ③ `ResizeObserver` 观察 `foreignObject` 里的文字块 | ① canvas 不认识表情 `<img>`（只能按空格估宽）、字体没到就不准（原项目为此在挂载前 `await document.fonts.load`）、两套结果取大值是在掩盖误差；② `offsetWidth` 是整数，行高 31.32 的小数丢失；`getBoundingClientRect` 在 CSS `zoom` 下是缩放后的视口坐标，要再除以 zoom；两者在字体 swap 后都不会重测 | ③ `contentRect` 是元素自身坐标系的 CSS px，不受 zoom 影响（实测 zoom 2/3 时 svg 宽 125.916 → 125.9，只有亚像素差）；字体晚到会再次回调；回调在渲染步骤里、React 更新落在之后的 MessageChannel 任务，所以新气泡首帧一定按加载尺寸（100×49.32）绘制，第二帧才是真实尺寸——"加载尺寸 → 真实尺寸"的 100ms 过渡不再需要原项目的双 rAF |
| 消息布局             | ① 逐条绝对定位（原 `useChatRows` 累加 bubbleTop/bottom 算出每条 top/left）② flex 纵向流 + 头像绝对定位                                                                                         | ① 每条消息的坐标依赖前一条的测量高度，测量是异步的（见上一行）就要再算一轮                                                                                                                                                                                                                          | ② 行高由气泡决定；头像 `position:absolute; top:-18.74`（`AVATAR.topToBubble`）不占行高；间距 `marginTop`；内容容器固定 `w-[1312px]`，滚动条出现时不改变坐标。实测坐标与设计稿一致（第 3 节）                                                                                                                                    |
| 追加气泡的过渡触发   | ① 双 `requestAnimationFrame` 后改尺寸（原 ChatBubble）② 依赖 ResizeObserver 回调时序                                                                                                           | ① 需要保存两个 rAF 句柄并在卸载时清理                                                                                                                                                                                                                                                               | 文字气泡用 ②；加载气泡没有测量可等，仍用 ① 翻转 `expanded`，`clip-path: inset()` 从裁掉 100px 过渡到 0                                                                                                                                                                                                                          |
| 行 key               | ① `message.id` ② 下标                                                                                                                                                                          | ① 流结束后临时气泡（没有 id）被持久化消息（新 id）替换 → remount → 100ms 过渡重播一次（"脉冲"，原项目用 `frozenPrevRects` Map 规避）                                                                                                                                                                | ② 下标即"槽位"：替换时组件和测量状态沿用；挂载时的行数用 `useState(rows.length)` 惰性记住，`index >= initialCount` 的行才是追加行（首屏行随 chat-in 一起出现，不做尺寸过渡）。配套把 chatStore 里"写入持久化消息"和 `streaming: null` 合并成同一次 `set`，列表不会渲染"临时气泡 + 持久化消息"并存的中间状态                     |
| 首屏气泡测量前       | ① 先按加载尺寸画一帧 ② `visibility:hidden` 到测量完成                                                                                                                                          | ① chat-in 入场的第一帧 opacity≈0，肉眼看不到，但滚动高度会先小后大                                                                                                                                                                                                                                  | ② `invisible` 仍参与布局，RO 照常测量                                                                                                                                                                                                                                                                                           |
| 自动滚到底部         | ① watch 消息数 / loading 后 `nextTick` 设 scrollTop（原项目）② ResizeObserver 观察内容容器高度                                                                                                 | ① 气泡尺寸在挂载后一帧才到（字体 swap 时更晚），watch 触发时 `scrollHeight` 还没变，滚不到底                                                                                                                                                                                                        | ② 内容容器一变高就 `scrollTop = scrollHeight`；100ms 尺寸过渡期间每帧回调，视觉上平滑跟随；新行、加载气泡出现、切换会话首屏都被覆盖                                                                                                                                                                                             |
| 输入框换行 / 粘贴    | ① Range API 手动插入 `\n` 文本节点或 `<br>` ② `document.execCommand('insertText')`                                                                                                             | ① Chrome 对末尾换行要补占位 `<br>` 才能显示光标，且原生撤销栈丢失                                                                                                                                                                                                                                   | ②（同原项目）。Chrome 会把第二行包成 `<div>`（冒烟实测 innerHTML 为 `你好呀<div>第二行<img …></div>`），`htmlToEmojiText` 把块级元素转成换行。jsdom 没有 `execCommand`，测试用桩把文本追加到焦点元素                                                                                                                            |
| 表情插入位置         | ① `insertAdjacentHTML('beforeend')` ② 光标处 `Range.insertNode`                                                                                                                                | ① 只能插到末尾                                                                                                                                                                                                                                                                                      | ② `emojiToHtml(token)` → `createContextualFragment` → 有选区且在输入框内就替换选区，否则追加；表情格与表情按钮 `onMouseDown preventDefault`，按下时输入框不失焦、选区不丢（原项目没做，靠浏览器"点按钮不清空 selection"的行为）                                                                                                 |
| 停止生成后的数据同步 | ① 中断后立刻重拉 `GET /messages`（任务描述）② 已显示的行留作本地 `aborted` 消息、不重拉                                                                                                        | ① 冒烟里气泡消失（问题 2.3）                                                                                                                                                                                                                                                                        | ② 下次重拉（切换会话、下一条回复结束）再与服务端对齐                                                                                                                                                                                                                                                                            |
| 头像显隐 / 间距规则  | 以 side 判断 / 以说话人身份判断                                                                                                                                                                | 只用 side 无法表达 spec 的"同侧换说话人 60"                                                                                                                                                                                                                                                         | `layoutRows` 以头像 URL 作说话人身份（原项目 `speakerKeyOf` 也是头像 URL）；1v1 下等价于 side，但 60 的规则有纯函数测试覆盖                                                                                                                                                                                                     |
| 流式期间的重渲染     | 不 memo / `memo(ChatBubble)`                                                                                                                                                                   | —                                                                                                                                                                                                                                                                                                   | `ChatBubble` props 全是原始值，`memo` 让每来一行时已有气泡跳过渲染。没有用 Profiler 计数，留作优化记录候选                                                                                                                                                                                                                      |

## 2. 遇到的问题

### 2.1 零尺寸容器里的 `<img>` 宽度为 0

- 现象：真实浏览器截图里聊天条图片、空态占位图不显示；Playwright 量到聊天条 `getBoundingClientRect()` 为 `w: 0, h: 67.66`（高度正常，只有宽度塌了）。
- 定位：`MEASURE_JS` 输出里 `strip.w === 0`；对照 characters agent 在 `SubCard.tsx` 留下的注释想到 preflight。
- 根因：Tailwind preflight 给 `img` 设了 `max-width: 100%`；ChatArea 根节点是原项目同款 0×0 "原点容器"，百分比按包含块宽 0 解析。jsdom 没有布局，单元测试测不出。
- 修复：聊天条、右上角装饰、底部装饰、空态占位四张直接挂在原点容器下的 `<img>` 加 `max-w-none`（头像三层、面板装饰、弹层装饰的父级都有宽度，不受影响）。
- 验证：HMR 后重量 `w: 1323`，截图可见。

### 2.2 `POST /chat` 在浏览器里报 CORS、curl 却正常

- 现象：console `No 'Access-Control-Allow-Origin' header is present` + `net::ERR_FAILED`，只有 chat 接口出错，其余接口 200；用 curl 带同样 Origin/Authorization/正文请求新起的后端一切正常。
- 定位：不再用 `with_server.py`（它吞掉服务端输出），自己 `nohup uvicorn … > backend.log` 起服务，日志第一行就是 `address already in use`。
- 根因：第一次冒烟失败时 `with_server.py` 没杀掉 `bash -c` 里的 uvicorn 子进程；而我每次运行前都 `rm` 掉 SQLite 文件。旧进程连接池里的连接仍指向已删除的 inode（所以列表、设置接口正常），chat 的流式生成器新开一条连接打开了刚被创建的空库 → 异常 → Starlette `ServerErrorMiddleware` 的 500 在 CORS 中间件之外，没有 ACAO 头，浏览器只能报 CORS。
- 修复：`lsof -t -iTCP:8011 -sTCP:LISTEN | xargs kill` 后重跑。
- 验证：backend.log 里 `POST /api/conversations/1/chat 200`，冒烟通过。

### 2.3 点击"停止"后已显示的 AI 气泡消失

- 现象：冒烟第二条消息在收到第一行"收到，管理员。"后点击停止，列表只剩"再来一次"，刷新后那行才出现；spec 要求"已显示的气泡保留"。
- 定位：backend.log 里 abort 之后紧接着一条 `GET /api/conversations/1/messages 200`；后端注释说明它在生成器下一次 `await` 写入处收到 `CancelledError` 才在 `finally` 里落库（mock 每 80ms 一块），GET 抢在落库前返回。
- 根因：客户端"abort 后立刻重拉"和服务端"察觉断开后再持久化"之间的竞态；真实 DeepSeek 下一块可能几秒才到，固定延时不可靠。
- 修复：`chatStore.sendMessage` 在 `controller.signal.aborted` 时不重拉，把 `streaming.bubbles` 转成本地 `status: 'aborted'` 的消息（负数 id）追加到列表并更新 `last_message`；正常结束和出错仍重拉。对应更新 `chatStore.test.tsx` 的中断用例（断言没有第二次 `/messages` 请求）。
- 验证：冒烟 `after_stop_texts` 末尾为 `['再来一次', '收到，管理员。']`，日志里 abort 后没有 GET；单元测试通过。

### 2.4 Playwright 点不到 0×0 的 `role="button"`

- 现象：`wait_for_selector('[role=button]')` 30s 超时，日志显示"resolved to 29 elements"但不可见。
- 根因：主卡 / 子卡按钮是零尺寸容器，Playwright 的可见性判断要求非空盒。
- 修复：等待用 `state='attached'`，点击用 `dispatch_event('click')`（React 的委托监听照常收到）。

### 2.5 Playwright 与缓存的 Chromium 版本不匹配

- 现象：`Executable doesn't exist at …chromium_headless_shell-1243`，本机缓存的是 1234。
- 修复：`launch(executable_path=<1234 的 headless shell>)`，不重新下载（同时后台补下了 1243）。

### 2.6 `grep -v '^    '` 把 JSON 嵌套行过滤掉

- 现象：`page.evaluate` 的 rows 看起来全是 `{}`，一度怀疑序列化失败。
- 根因：为了去掉 Python traceback 的缩进行，把 `json.dumps(indent=1)` 里缩进 ≥4 的行也过滤了。
- 修复：结果写到 `results.json` 再读。

## 3. 实测数据

冒烟环境：`AI_MOCK=1`（后端每 80ms 发一块）、headless Chromium 1234、视口 1920×1080（zoom 1）、Apple Silicon；脚本在 scratchpad `smoke.py`。

| 指标                                 | 数值                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Enter → 加载气泡出现                 | 21 ms                                                                                                        |
| Enter → 首个 AI 气泡"收到，管理员。" | 328 ms（`\n` 在后端第 2 块，即 ≈160 ms 发出；其余是 Playwright 轮询 + 渲染）                                 |
| Enter → 三行全部出现、发送按钮恢复   | 616 ms                                                                                                       |
| 原项目对比                           | 原项目等全文后再逐条播放，没有"首行时间"；真实 DeepSeek 下"首行出现 − 全文完成"的差值留给主会话用真实 Key 测 |

坐标核对（`getBoundingClientRect`，zoom 1）：

| 项目                      | 实测                                                       | 设计值                                                       |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 聊天条                    | (546.02, 114.44) 1323×67.66                                | (546.02, 114.44) 1323×67.67                                  |
| 我方气泡右缘              | 1746.34                                                    | `CHAT_ANCHOR.mineBubbleRight` 1746.34                        |
| 对方气泡左缘              | 644.63                                                     | `otherBubbleX` 644.64                                        |
| 首条气泡顶                | 262.14                                                     | 188.84 + (243.42 − 188.84) + 18.74 = 262.16                  |
| 我方 / 对方头像盒左缘、顶 | (1746.45, 243.41) / (554.47, 357.03)                       | (1746.46, 243.42) / (554.48, 气泡顶 − 18.74 = 357.03)        |
| 跨方向间距 / 同人间距     | 33.00 / 14.00                                              | 33 / 14                                                      |
| 两行我方气泡              | 文字 83.52×62.63 → rect 109.52×80.63 → svg 125.92          | 62.63 = 2×31.32；rect = 文字 + 26 / + 18；svg = rect + 2×8.2 |
| 单行对方气泡高            | 49.31                                                      | 31.32 + 18 = 49.32                                           |
| 加载气泡                  | 108.18×49.31                                               | 8.2 + 100，高同单行                                          |
| zoom 2/3（1280×720）      | svg CSS 宽 125.9 / 180.372 / 306.309 不变；视口右缘 1164.2 | 1746.34 × 2/3 = 1164.23                                      |

测试与构建：

| 检查                                | 结果                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm vitest run src/features/chat` | 5 文件 29 用例通过（chatRows 3、emojiHtml 6、ChatInput 7、ChatArea 6、chatStore 7）                                                                                                                                                                               |
| `pnpm test`（全仓）                 | 18 文件 96 用例（最终一次运行；此前 19/97，差异是 characters agent 移除了自己的临时用例）                                                                                                                                                                         |
| `pnpm lint` / `pnpm typecheck`      | 0 error 0 warning / 通过                                                                                                                                                                                                                                          |
| `vite build`                        | CSS 41.82 KB（gzip 8.63）、JS 366.51 KB（gzip 133.90）；基础设施阶段为 17.47 / 282.01 KB，增量含三个功能目录                                                                                                                                                      |
| Tailwind 类核验                     | dist css 里 `fill-bubble-mine`、`rounded-b-panel`、`bg-linear-to-b`、`duration-(--anim-bubble)`、`transition-[clip-path]`、`empty:before:content-[attr(data-placeholder)]`、`data-disabled:opacity-50`、`shadow-[0_0_8px_var(--color-chat-bar-magenta)]` 全部生成 |

## 4. 与原项目的已知差异

- 换行文本的气泡宽固定为最大宽 660（`w-fit` 达到 `max-w-[634px]` 后取满），原项目取最宽一行的实际宽度，可能窄几个像素。
- 末尾装饰（`chat_end_deco`，原项目只在导出模式显示）不再渲染，但 32+26+32+100 = 190px 的尾部空间保留，最后一条消息不会被输入面板和 60px 遮罩条盖住；`CHAT_ANCHOR.bottomPad` 只提供了 100，其余 90 写在 `MessageList.TAIL_SPACE` 注释里。
- 表情弹层只有进入动画（`animate-pop-up`），关闭直接卸载（index.css 已冻结，无退出关键帧）。
- 中文输入法组词阶段的 Enter 不发送（`nativeEvent.isComposing`），原项目没有处理。
- 表情按钮 / 发送按钮 / 表情格 `onMouseDown` 阻止默认，输入框不失焦（原项目没有）。
- 中断后不重拉消息（第 2.3 节），原设计是重拉。
- 不移植：移动端分段头图与 textarea、导出模式、图片消息、角色名称悬浮。

## 5. 留给 docs/interview.md 的锚点

- `#bubble-measure`：ResizeObserver 测量 + 首帧加载尺寸的过渡（`ChatBubble.tsx`）。
- `#flex-layout`：flex 流式布局 + 下标槽位 key（`MessageList.tsx`、`chatRows.ts`）。
- `#abort-race`：停止生成与后端持久化的竞态（`chatStore.ts` 第 2.3 节）。
- `#preflight-max-width`：与 characters agent 的同一条经验，聊天区四张图也踩到。
