# 目标

在不改变已确认功能的前提下，改进聊天区的自动滚动体验、首屏 JS 体积和长会话性能，并把滚动规则和输入框编辑行为分别提取为可单独测试的自定义 Hook（`useChatAutoScroll`、`useChatComposer`）。每项性能改动都有同一方法测得的前后数据，写进 `docs/notes/measurements.md`、`docs/interview.md` 和 `docs/frontend.md`，面试时能讲清楚“为什么做、怎么量、改善多少、代价是什么”。

# 范围

1. 自动滚动：打开会话、我方主动发送时滚到底部；用户原本接近底部时，新回复到达自动跟随；用户向上查看历史时保持当前位置，并显示“回到底部 / 有新消息”按钮；加载更早历史时保持当前可见消息的位置（本次实现历史消息分页，见 D13）。
2. 组件懒加载：`ChatPage` 与设置弹窗 `SettingsDialog` 拆成独立 chunk，打开时提供轻量加载反馈（样式见 D15）；切断 `authStore` 对 `chatStore` / `settingsStore` 的静态引用，让聊天与设置相关模块真正离开首包；已登录用户刷新 `/` 时不能因为懒加载变慢。
3. 长列表虚拟化与前后对比：构造 100 / 500 / 2000 条混合消息（双方、多行、含表情），在 1× 与 4× CPU 降速下比较会话切换耗时、滚动帧时长、DOM 节点数；基线已证明长会话明显变慢，引入支持动态高度的虚拟列表；同时实现历史消息的游标分页（D13）。
4. 提取 `useChatAutoScroll({ conversationId })`，返回 `scrollRef`、`contentRef`、`isAtBottom`、`scrollToBottom`：监听内容尺寸变化、判断是否接近底部、向上浏览时暂停跟随、主动发送时滚到底部、提供回到底部操作、卸载时清理监听与 observer。
5. 提取 `useChatComposer({ onSend, disabled })`，返回 `inputRef`、`handleKeyDown`、`handlePaste`、`insertEmoji`、`submit`：Enter 发送与组合键换行、输入法选词保护、粘贴纯文本、保存与恢复光标并插入表情、contenteditable DOM 转消息文本、发送后清空。`ChatInput` 只保留 JSX；网络请求与流式状态仍由 `chatStore` 管理。
6. 文档同步：度量数据与方法、面试讲稿（亮点、优化记录、问答）、前端项目文档中过时的描述、`docs/conventions.md` 第 1 条的补充说明；同步 `docs/api.md` 的消息分页接口与流结束后的重拉说明。

# 非目标

- 不改变气泡样式与尺寸规则、流式按行出现、停止生成、切换会话时回复写回原会话等已确认行为。
- 重新打开会话不恢复上次的滚动位置，总是在底部。
- 回到底部按钮不显示未读条数。
- 不为 Safari 输入法补 `keyCode === 229` 兜底：本项目只有 Chromium 的测试环境，无法验证；作为已知差异写进文档。
- 不更换状态管理方案，不引入路由数据加载框架；网络请求与流式状态仍在 `chatStore`。
- 不改字体加载策略：929 KB 的字体仍是首屏传输主体，但不在本次范围。
- 不做移动端适配，不测 Safari / Firefox。

# 验收示例

用户可见行为的验收写在完整目标规格的 Scenario 中；这里只列规格之外的工程、度量与文档要求。

- 入口 JS 不包含聊天页、设置弹窗、`chatStore`、`settingsStore` 与虚拟列表库的代码；入口 JS 的 gzip 体积比改动前（约 133 KB）至少小 30%；前后数据和 chunk 清单记录在 `docs/notes/measurements.md`。
- 已登录用户在无网络限速时刷新 `/`：聊天页 chunk 与 `/me` 请求在同一时刻前后开始（开始时间相差不超过 20 ms），从导航开始到聊天区渲染完成的中位数不比改动前多出 50 ms 以上；登录后跳转到聊天页、预取完成后打开设置弹窗都不显示加载动画。
- 用同一份 100 / 500 / 2000 条混合消息的种子数据、同一个 Playwright 脚本，在 1× 与 4× CPU 降速下各测 5 次取中位数，改动前后各测一轮，记录：打开会话的耗时与传输的消息字节数、加载全部历史后聊天区的 DOM 节点数、脚本滚动时的帧时长 p50 / p95 / 最大值。4× CPU 降速下打开 2000 条消息会话的耗时比改动前少 50% 以上；加载全部 2000 条后聊天区 DOM 节点数比改动前少 90% 以上，滚动帧时长 p95 不超过 33 ms。
- `frontend/src/features/chat/useChatAutoScroll.ts` 导出 `useChatAutoScroll({ conversationId })`，返回值包含 `scrollRef`、`contentRef`、`isAtBottom`、`scrollToBottom`；消息列表组件不再直接创建 ResizeObserver 或监听滚动，只负责渲染消息和按钮。卸载后不残留监听器和 observer（单元测试断言 disconnect 与 removeEventListener 被调用）。
- `frontend/src/features/chat/useChatComposer.ts` 导出 `useChatComposer({ onSend, disabled })`，返回值包含 `inputRef`、`handleKeyDown`、`handlePaste`、`insertEmoji`、`submit`；`ChatInput.tsx` 中不再有键盘、光标、粘贴和 DOM 转文本的逻辑。单元测试覆盖 Enter 发送、Shift / Ctrl / Cmd / Alt + Enter 不发送、输入法选词时不发送、粘贴只插入纯文本、表情插入到保存的光标处、空白内容不发送、发送后清空、禁用时 `submit` 与 `insertEmoji` 不生效。
- `rerender.measure.test.tsx` 重新运行，流式回复期间的渲染次数与文档记录一致，变化时更新文档并说明原因。
- 文档：`docs/notes/measurements.md` 新增本次度量的方法、种子数据说明与前后原始数据；`docs/interview.md` 新增或更新技术亮点与优化记录（按五段写，代码处有 💡 注释指回对应标题），更新面试问答中过时的回答；`docs/frontend.md` 中描述滚动、输入框、消息加载与产物体积的过时内容全部更新；`docs/api.md` 写明消息分页接口；`docs/conventions.md` 第 1 条补充 D11 的说明；文档中写死的测试数量等统计重新核对。
- 仓库根 `pnpm check:docs` 与 `prettier --check .` 通过；前端 lint / typecheck / test / build、后端 ruff / pytest、`pnpm e2e` 全部通过。

# 约束与不变量

- 界面是 1920×1080 设计画布经 CSS zoom 等比缩放；Chromium 下 `scrollTop`、`scrollHeight`、`clientHeight`、ResizeObserver 的尺寸都是设计 px，阈值直接用设计 px，不做换算（已实测）。底部距离的测量误差为 −1 到 +1 px，判断“在底部”至少留 2 px 容差。
- 遵守 `docs/conventions.md` 五板斧、中文文档注释与 emoji 规则；新增 💡 注释必须指向 `docs/interview.md` 中存在的标题，`pnpm check:docs` 通过。
- 生产依赖最多新增一个：`@tanstack/react-virtual`（无头虚拟列表，打包后约 7.9 KB gzip）。
- 消息接口响应从数组改为 `{items, has_more}`，前后端同时修改，不保留旧格式（五板斧：不做向后兼容）。
- 前后对比使用同一台机器、同一份种子数据、同一脚本；原始数据保存在度量笔记中，结论只写实测值。
- 现有 Vitest、pytest、Playwright 用例全部通过；`rerender.measure.test.tsx` 的渲染次数重新测量并更新文档。
- 工作区是 `main` 分支的当前目录；上一个需求已归档，本需求的提交不混入其他改动。

# 决策

- D1 接近底部的阈值为 80 设计 px，约一条单行消息的高度（气泡 49.32 + 间距 33）。滚动距离在阈值内继续跟随；超过则暂停跟随。只有用户向上滚动才会暂停跟随，程序自己滚动或内容变高不会误判为用户离开底部。
- D2 按钮在暂停跟随时出现：没有新内容时显示“回到底部”，暂停期间有新的消息行到达时改为“有新消息”；回到阈值内自动隐藏。是否“有新内容”按消息行数判断，字体加载或测量抖动造成的高度变化不算。
- D3 不显示未读条数：同一时间只有一条回复在流式进行，我方发送总会回到底部，条数最多是一条回复的行数，信息量小。
- D4 点击按钮平滑滚动到底部；打开会话、我方发送、自动跟随都用瞬时滚动，保持现有观感。
- D5 重新打开会话总是在底部：消息区按会话重新挂载并播放入场动画，本来就是全新视图，恢复位置需要额外的跨会话状态。
- D6 长会话已明显变慢，满足引入虚拟列表的条件。基线（当前实现、种子数据、Playwright + Chromium、4× CPU 降速）：2000 条时切换会话约 1178 ms、聊天区约 2.1 万个 DOM 节点、滚动 p95 帧时长 54.5 ms；500 条时切换约 376 ms。无降速时 2000 条切换约 245 ms。
- D7 虚拟列表选用 `@tanstack/react-virtual`：它不接管滚动容器，`useChatAutoScroll` 仍能用同一个 `scrollRef` 实现全部滚动规则；`react-virtuoso` 自带跟随底部与加载更早的滚动逻辑，和自定义 Hook 会形成两套方案，且体积约 20.2 KB gzip。行高按实际测量结果更新，头像显隐与间距仍按完整列表计算，保证与现有布局一致。
- D8 懒加载时预取 chunk，避免请求瀑布和 React 19 的 Suspense 兜底节流（兜底一旦显示，内容至少 300 ms 后才替换）：有 token 时在入口脚本启动阶段就开始加载聊天页 chunk，与 `/me` 并行；登录页空闲时预取聊天页 chunk；进入聊天页后空闲时预取设置弹窗 chunk。只开 `React.lazy` 不预取时，实测无限速刷新 `/` 从约 22 ms 变成约 323 ms。
- D9 用“用户切换”注册表替代 `authStore` 对聊天、设置 store 的直接引用：两个 store 在模块加载时登记自己的重置函数，登录态变化时只重置已加载的 store；未加载的 store 没有旧数据，不需要重置。实测切断后入口 chunk 少约 10 KB（未压缩）。
- D10 `useChatComposer` 保留 `disabled` 参数：禁用时 `submit` 与 `insertEmoji` 不生效。现状是回复期间点击仍打开着的表情弹层会把表情插入到禁用的输入框里，改后不再插入。
- D11 在 `docs/conventions.md` 第 1 条补一句说明：把一组内聚的有状态行为（监听、ref、键盘与光标规则）提取为同目录的自定义 Hook 属于按职责拆分，不算抽象，前提是参数和返回值只服务当前调用方；两个 Hook 的取舍写进面试讲稿。
- D13 本次实现历史消息分页（用户选择 Q1）：`GET /api/conversations/{id}/messages` 支持 `limit`（1–100，默认 50）与 `before_id`，返回 `{items, has_more}`，`items` 按 id 升序。打开会话只取最近 50 条；滚到距顶部 200 设计 px 以内且 `has_more` 为 true 时自动加载更早 50 条，加载期间顶部显示加载气泡，同一时刻只有一次加载；插入更早消息后可见消息保持原位（Chromium 在 scrollTop 为 0 时不做滚动锚定，需要手动补偿）。流结束后只拉最新一页并与已加载的更早历史合并。依据：现在切换会话和每条回复结束后都重拉全部消息，2000 条约 424 KB JSON。
- D14 回到底部按钮为居中浅色胶囊（用户选择 Q2）：位于消息区下方、输入面板上方，水平中心与消息区和底部装饰对齐；复用浅灰按钮底色、深灰文字、下箭头素材、气泡阴影与弹窗淡入动画；只用现有令牌与素材，不新增全局样式。
- D15 懒加载反馈为延迟 200 ms 出现的三个方块闪烁动画（用户选择 Q3）：复用加载气泡的动画；聊天页未就绪时显示在页面中央，设置弹窗未就绪时显示在弹窗位置。
- D12 本需求作为单个 change 推进，不拆 Supervisor 子任务：第 1、3、4 项都集中修改 `MessageList`，拆开会反复冲突；第 2、5 项规模小。

# 待解决问题

无。Q1（分页）、Q2（按钮样式）、Q3（加载反馈）已由用户选择推荐方案，见 D13–D15。

# 验证预期

- 前端 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；后端 `ruff check`、`ruff format --check`、`pytest`；`pnpm e2e`；仓库根 `pnpm check:docs` 与 `prettier --check .`。
- 新增 Hook 单元测试：`useChatAutoScroll` 的跟随、暂停、按钮状态、发送滚底、卸载清理；`useChatComposer` 的 Enter / 组合键 / 输入法 / 粘贴 / 表情 / 禁用规则。
- 新增或扩展 Playwright 用例：向上滚动后出现按钮、点击回到底部、新回复不打断浏览、加载更早历史后可见消息位置不变；后端 pytest 覆盖分页接口的边界（`before_id`、`limit` 越界、他人会话）。
- 度量脚本：同一份 100 / 500 / 2000 条种子数据，1× 与 4× CPU 降速，各跑 5 次取中位数，记录切换耗时、滚动帧时长分位数、DOM 节点数、首包 JS 体积与请求顺序；前后数据写进度量笔记，并同步面试讲稿与前端项目文档。
