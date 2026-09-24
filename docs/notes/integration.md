# 集成修正（integration）

记录 Build 阶段最后一轮联调修正：停止生成改为显式 stop 协议（消除竞态）、密码规则统一、对话框像素还原、设置页标签保留草稿、免责声明修订，以及真实浏览器全链路冒烟。日期 2026-09-24，本机 macOS / Apple Silicon，后端 `AI_MOCK=1`。

## 1. 技术选型

| 项目                     | 候选                                                                                                                                                                                                                | 放弃理由                                                                                                                                                                                                          | 结论                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 停止生成的数据同步       | ① abort 后立刻重拉 `GET /messages`（原契约）② abort 后把已显示的行留作负数 id 的本地 `aborted` 消息，等下次重拉再对齐（chat agent 的临时方案）③ abort 后固定延时再重拉 ④ 新增 `POST /chat/stop`，服务端落库后才返回 | ① 有竞态（§2.1）；② 用客户端状态掩盖协议缺陷，本地消息与服务端在"下次重拉"之前是两套真相，且负数 id 混进消息列表；③ 真实 DeepSeek 下一块可能几秒才到，延时多少都不可靠                                            | ④：确定性协议——stop 返回即代表已持久化，`[DONE]` 也只在落库之后发出，前端永远在"落库之后"重拉                                                                                                                                                                                                                    |
| stop 如何唤醒生成器      | ① 只在"每帧转发前"检查 `asyncio.Event` ② `asyncio.wait` 让"上游下一帧"与"stop 事件"赛跑，先到者胜 ③ 上游消费放独立 task + `Queue`                                                                                   | ① 生成器挂在 `await` 上游下一帧时看不到事件，stop 要等到下一帧到达才返回：mock 最多 80 ms，真实 DeepSeek 首个 token 前可能是秒级，上游挂死时是 60 s 读超时；③ 仍要在 `queue.get()` 上做同样的赛跑，多一层没有收益 | ②：`next_frame()` 为每帧建两个 task（`anext(upstream)` 与 `stop.wait()`），stop 先到就取消对上游的等待，上游连接随之关闭；测试用"发完 2 帧后永远不再出数据"的 respx 流证明 stop 不依赖上游                                                                                                                       |
| stop 与本地 abort 的顺序 | ① 先 `abort()` 再 `POST stop`（stop 只负责等落库）② 先 `POST stop`，返回后再 `abort()` 兜底                                                                                                                         | ① 服务端多数时候在收到 stop 前就已察觉断开并注销活动流，`stopped` 几乎总是 `false`，接口语义变得含糊                                                                                                              | ②：`[DONE]` 与 stop 响应谁先到都收敛到 `sendMessage` 的同一次重拉；`abort()` 只兜底 `stopped=false`（流尚未登记 / 已结束）                                                                                                                                                                                       |
| 前端"已请求停止"的表达   | ① `StreamingState` 新增 `stopping` 字段 ② 复用 `pending`：点击停止即置 `false`                                                                                                                                      | ① 多一个字段，且"pending 但 stopping"是不该存在的组合                                                                                                                                                             | ②：点击即收起加载气泡（spec 要求），`[DONE]` 时 `pending === false` 就不把半行当最后一个气泡（与后端丢弃半行一致），重复点击也由它挡住                                                                                                                                                                           |
| 活动流登记表             | ① `dict[int, asyncio.Event]` ② `dict[int, ActiveStream]`（stop + finished 两个事件）                                                                                                                                | ① 只有 stop 事件时，stop 接口无从得知落库是否完成                                                                                                                                                                 | ②：`finished` 在 `finally` 里落库之后置位，stop 接口 `await finished.wait()`；注销只删自己的登记（`active_streams.get(id) is stream`），同会话并发两条流时不会误删                                                                                                                                               |
| 密码规则                 | ① 6–64 位 + 单独校验 UTF-8 不超 72 字节（原实现）② 6–64 个可打印 ASCII（`^[\x21-\x7E]{6,64}$`）                                                                                                                     | ① 契约写 6–64 位，实际 30 个汉字（90 字节）被 bcrypt 拒绝，前端按位数放行、后端 422，两边规则不一致                                                                                                               | ②：一条正则前后端各写一遍（Pydantic `Field(pattern=…)` / `PASSWORD_RE`），天然 ≤ 64 字节，删掉字节数校验器                                                                                                                                                                                                       |
| DialogShell 与设置对话框 | ① 设置对话框自己复制一份外壳 ② `DialogShell` 加 `variant="settings"` + `titleGap`                                                                                                                                   | ① 遮罩 / 面板 / 关闭钮逻辑写两遍                                                                                                                                                                                  | ②：默认样式逐项对应 `_mixins.scss` 的 `dialog-shell`；`titleGap` 就是 mixin 的 `$title-mb` 参数（dc 10 / dm 14 / sd 16，三个调用点本来就不同，替掉了 `-mt-1` 抵消的写法）；`variant="settings"` 承担原 `SettingsDialog.vue` 自带外壳的四处差异（标题 20/600/16、关闭钮 24px 半透明、`max-h-[80vh]` + 纵向 flex） |
| 设置页切换标签保留草稿   | ① 草稿状态提升到 `SettingsDialog`（原 Vue 的做法）② 六个标签页同时挂载、非当前 `hidden`                                                                                                                             | ① 六份草稿回到父组件，每个 setState 重渲染整个对话框，正是 settings agent 当初拆分的理由                                                                                                                          | ②：`SettingsDialog` 改动 10 行；代价是打开对话框时 `GET /settings`、`/prompts`、`/data/stats` 三个请求同时发出（此前按标签按需）                                                                                                                                                                                 |
| 冒烟用的浏览器           | ① `pnpm dlx playwright`（会下载 1.63 的浏览器）② scratchpad 里 `npm i playwright@1.63.0` + `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`                                                                                     | ① 端口 5173 被用户占用、`e2e/` 由另一位 agent 同时安装，不能动仓库；重复下载浏览器没有意义                                                                                                                        | ②：1.63.0 的 `browsers.json` 要求 chromium revision 1243，本机缓存正好有 `chromium_headless_shell-1243`，零下载                                                                                                                                                                                                  |

## 2. 遇到的问题

### 2.1 点击"停止"后已显示的 AI 气泡消失（核心竞态，面试主讲）

- 现象：chat agent 在真实浏览器冒烟里发现——发消息后收到第一行"收到，管理员。"时点击停止，列表只剩用户消息"再来一次"，刷新后那一行才出现；spec 要求"已显示的气泡保留"。
- 定位方法：看 uvicorn 日志的请求顺序——abort 之后紧接着一条 `GET /messages 200`；对照 `stream_reply` 的实现，它只在生成器下一次向客户端写入（mock 每 80 ms 一块）时才收到 `CancelledError`、才在 `finally` 落库；GET 抢在落库之前返回了空结果。
- 根因：客户端"abort 后立刻重拉"和服务端"察觉断开后再持久化"是两条互不知情的异步路径，中间没有任何顺序保证；真实 DeepSeek 两块之间可能相隔数秒，靠延时不可能修好。chat agent 用负数 id 的本地 `aborted` 消息顶替，只是把不一致藏到了"下次重拉"。
- 修复（协议层）：
  - 后端新增 `POST /api/conversations/{id}/chat/stop`。`stream_reply` 启动时把 `ActiveStream(stop, finished)` 登记到进程内的 `active_streams[conversation_id]`；每帧改由 `next_frame()` 取——它把 `anext(upstream)` 和 `stop.wait()` 放进 `asyncio.wait(FIRST_COMPLETED)`，stop 先到就取消对上游的等待并返回 `None`；主循环退出后关闭上游、在 `finally` 里同步落库（已完成行 `aborted`、半行丢弃、上下文只追加完整行）、注销登记、置位 `finished`，最后才 `yield "data: [DONE]"`。stop 接口 `await finished.wait()` 之后返回 `{"stopped": true}`；没有登记时直接 `{"stopped": false}`。会话归属仍由 `ConversationDep` 校验，跨用户 404。
  - 前端 `stopGeneration`：先把 `pending` 置 `false`（加载气泡立即消失），`await stopChat()`，再 `controller.abort()` 兜底；`sendMessage` 在 `streamSse` 返回后（无论是 `[DONE]` 还是 abort）统一重拉——此时服务端一定已落库。`onDone` 只在 `pending` 仍为 `true` 时把剩余半行显示为最后一个气泡。删除了负数 id 本地 aborted 消息的整段逻辑。
- 验证：
  - 后端 `test_stop_returns_after_persist_without_waiting_for_upstream`：respx 流发完"第一行\n第二""行\n第三"后 `await Event().wait()` 永不返回；`stop_chat()` 在 `wait_for(…, 2)` 内返回 `stopped=True`，返回瞬间库里已是 `[("other","第一行","aborted"),("other","第二行","aborted")]`、上下文 `第一行\n第二行`、半行"第三"不存在，随后生成器产出 `[DONE]`，`active_streams` 为空。另有无活动流 → `stopped=false`、跨用户 404 / 未登录 401、正常结束也注销登记三条用例；原有 `aclose()` 与 `task.cancel()` 两条断开路径的用例照常通过。
  - 前端 `chatStore.test.tsx`：请求顺序断言 `['messages','chat','chat/stop','messages']`；订阅 store 记录出现过的 bubbles，半行"第二"从未出现；`stopped=false` 时靠 abort 结束桩流再重拉；重复调用只发一次 stop。
  - 真实浏览器（Playwright + headless shell 1243，mock 后端）：收到"收到，管理员。"后点击停止，点击瞬间加载气泡已不在；`POST /chat/stop` 52 ms 返回 `{"stopped":true}`，64 ms 后发送按钮恢复；Playwright 的请求记录与 uvicorn 日志都是 `POST …/chat/stop 200` → `GET …/messages 200`；停止后界面 6 条气泡，末尾为"再来一次""收到，管理员。"，接口里最后一条 `status=aborted`；刷新并重新选中会话后仍是同样 6 条。

### 2.2 客户端断开时 `asyncio.wait` 会留下孤儿任务

- 现象：设计 `next_frame()` 时意识到——Starlette 察觉断开后取消的是生成器所在的 task，`asyncio.wait` 本身不会取消它等待的两个子 task，`anext(upstream)` 会继续挂着 httpx 连接直到上游下一个 token 才结束。
- 定位：读 `asyncio.wait` 文档（"does not cancel the futures"）与 Starlette `StreamingResponse` 的 task group 取消方式。
- 修复：`next_frame()` 里 `except asyncio.CancelledError: frame_task.cancel(); raise`，`finally: stop_task.cancel()`；取消会直接投递进 `stream_chat` 的 `async with client.stream(...)`，上游连接随之关闭——比原来 `async for` 被取消后靠 GC 的 asyncgen 钩子关闭更及时。
- 验证：`test_task_cancellation_persists_as_aborted` 通过，`pytest` 输出除 Starlette 的 `httpx2` 弃用告警外没有 "Task was destroyed but it is pending"。

### 2.3 冒烟脚本的两次误判（先怀疑测量，再怀疑被测）

- 现象 A：第一轮 15 步只过 4 步，主页所有请求 401。根因：注册表单校验那一步用同一个 `BrowserContext` 开新页并 `localStorage.removeItem('baker.token')`——同 context 共享 localStorage，把主页面也登出了。修复：独立 `browser.newContext()`。
- 现象 B：第二轮"首个 AI 气泡 15 ms"（mock 第一个 `\n` 在第 2 块，最早 160 ms 才可能出现），随后"停止"那一步在没有任何 AI 行时就点了停止，断言失败，后面清空消息的等待也跟着超时。根因：气泡选择器 `svg foreignObject > div` 把加载气泡也数进去了——`LoadingBubble` 与 `ChatBubble` 是同一套 SVG + `foreignObject` 范式。修复：`svg:not([role=status]) foreignObject > div`。修正后首个 AI 气泡 176 ms，符合 mock 时序。
- 教训：两次都是脚本的问题，被测代码没有错；先用后端日志核对请求顺序，再改脚本。

### 2.4 对话框截图拍到入场动画的中间帧

- 现象：`waitForSelector('[role=dialog]')` 之后立刻截图，设置对话框半透明，对话管理 / 提示框整块看不见。
- 根因：`animate-dialog-in` 0.15 s 从 `opacity: 0` 淡入，元素 attached 时动画刚开始。
- 修复：截图前 `Promise.all(dialog.getAnimations({subtree: true}).map(a => a.finished))`。第一版写成 `document.getAnimations()`，脚本挂死 120 s——主卡角标的 `card-chat-wiggle` 是 `infinite`，`finished` 永远不兑现；改成只等对话框子树。
- 验证：三个对话框截图清晰，与 §3 的计算样式一致。

### 2.5 Vitest 里 async 辅助函数返回 Promise 被展平

- 现象：三条停止用例各超时 5 s。
- 根因：`async function startStreaming(): Promise<Promise<void>>` 里 `return sending`，async 函数会把返回的 Promise 展平，`await startStreaming()` 等的是整条流结束。
- 修复：返回 `{ sending }`。

### 2.6 tabpanel 的 `aria-label` 与表单控件重名

- 现象：设置对话框 8 条用例失败，`getByLabelText('世界观设定')` 匹配到多个元素。
- 根因：给每个 `role="tabpanel"` 加了 `aria-label={tab.label}`，与 textarea 的 `aria-label="世界观设定"` 同名。
- 修复：去掉 tabpanel 的 aria-label（标签页由 `role=tab` 已可访问）。

## 3. 实测数据

| 指标                                   | 数值                                                      | 测量方法                                                                   |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| 后端测试                               | 64 → 70 个用例，13.6 s                                    | `.venv/bin/pytest -q`                                                      |
| 前端测试                               | 96 → 102 个用例，19 个文件                                | `pnpm test`                                                                |
| 构建                                   | CSS 41.76 KB（gzip 8.62）、JS 366.92 KB（gzip 133.96）    | `pnpm build`（含其他 agent 同期加入的字体子集，不能单独归因）              |
| Enter → 加载气泡 / 首个 AI 行 / 三行齐 | 14 ms / 176 ms / 601 ms                                   | Playwright `waitForFunction` 轮询，mock 每 80 ms 一块、首个 `\n` 在第 2 块 |
| 点击停止 → stop 响应 / 发送按钮恢复    | 52 ms / 64 ms（含 CORS 预检与 SQLite 写入）               | `page.waitForResponse` + `waitForSelector('button[aria-label="发送"]')`    |
| stop 不依赖上游下一帧                  | 上游永不发第 3 帧，stop 仍在 2 s 超时内返回（实际毫秒级） | `test_stop_returns_after_persist_without_waiting_for_upstream`             |
| 全链路冒烟                             | 15/15 步通过，浏览器 console 0 错误                       | scratchpad `pw/smoke.js`                                                   |

对话框计算样式核对（`getComputedStyle`，视口 1920×1080）：

| 项目               | 原 SCSS                                                        | 实测                                                                                 |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 遮罩               | `rgba(0,0,0,.55)`                                              | `rgba(0, 0, 0, 0.55)`                                                                |
| 面板（三个对话框） | padding 28/32/20、radius 14、边框 1px #cac9c9、阴影 0 8 32 .45 | `28px 32px 20px` / `14px` / `1px rgb(202,201,201)` / `0px 8px 32px rgba(0,0,0,0.45)` |
| 面板宽             | ns 280 / dc 348 / sd 560                                       | 280 / 348 / 560px                                                                    |
| 设置面板限高       | `max-height: 80vh`，flex column                                | `864px`，`flex` / `column`；免责声明页正文在面板内滚动                               |
| 标题 dc            | 22px / 500 / mb 10                                             | `22px` / `500` / `10px`                                                              |
| 标题 sd            | 20px / 600 / mb 16                                             | `20px` / `600` / `16px`                                                              |
| 关闭钮 dc / ns     | top 8 right 10，28×28 圆形，22px，#e3e1e1                      | `8px` / `10px`，`28px×28px`，radius 圆，`22px`，`rgb(227,225,225)`                   |
| 关闭钮 sd          | top 12 right 16，24px，白色 opacity .5，无底无圆角             | `12px` / `16px`，`24px`，`rgb(255,255,255)` opacity `0.5`，radius 0                  |

## 4. 与此前记录的差异 / 留给主会话

- `docs/notes/chat.md` §1 "停止生成后的数据同步"、§2.3、§4 "中断后不重拉" 描述的是被本次替换掉的方案；`docs/notes/settings.md` §4 里"标题 / 关闭钮与外壳不一致""标签页切换即卸载""免责声明第一节未改"三条已经修正。
- 登记表是进程内的：后端多 worker 部署时 stop 请求可能落到另一个进程（返回 `stopped=false`，前端退回 abort → 断开落库的兜底路径，仍然一致，只是 stop 变成"可能要等下一帧"）。Render 单实例不受影响。
- 退出登录时没有主动 abort 正在进行的流：流会继续写进 store，结束后的重拉因无 token 得到 401（`toastError` 对 401 静默）；`StreamingState.controller` 保留着，需要时一行即可接上。
- `DialogShell` 的 `actions` prop 没有任何调用点，已删除。
- 设置对话框现在一打开就发 `GET /settings`、`/prompts`、`/data/stats` 三个请求（此前按标签按需）。

## 5. 面试锚点

- `docs/interview.md#abort-race`：`backend/app/routers/chat.py` 的 `ActiveStream` / `next_frame` / `stop_chat` 与 `frontend/src/features/chat/chatStore.ts` 的 `stopGeneration`（§2.1、§2.2）。
- `docs/interview.md#sse-persist`：`finally` 里同步落库的取消安全性，本次补上了"落库之后才发 `[DONE]`"这一层保证。
