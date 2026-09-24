# 工具栏、设置对话框、对话管理、数据管理（settings）

记录移植原 `App.vue` 工具栏 + E 键、`SettingsDialog.vue`（925 行）、`DeleteConfirmDialog.vue`、`DataManagerDialog.vue` 到 `frontend/src/features/settings/` 时的选型、问题与实测数据。日期 2026-09-24。

## 1. 技术选型

| 项目                                                                 | 候选                                                                                                                                                                               | 放弃理由                                                                                                                                                                                             | 结论                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置对话框的拆分                                                     | ① 单文件 `SettingsDialog.tsx` 照搬 Vue 的一个组件持有全部草稿 ② 每个标签页一个组件，各自持有草稿与请求状态                                                                         | ① 六个标签页的草稿（温度、Token、世界观、角色、提示词、确认态、连接测试态）全堆在父组件，任何一个 setState 都重渲染整个对话框；Vue 里 `watch(open)` 一次性同步六份草稿的写法在 React 里要变成 effect | ② `SettingsDialog` 只做标签切换（40 行），六个 `*Tab.tsx` 各 60–120 行；标签页卸载即丢草稿，下次进入从 store 重新取，天然等价于原来的"打开时同步" |
| 角色提示词草稿与 store 的同步                                        | ① `useEffect(() => setDraft(current.prompt), [current])` ② 给编辑区加 `key={selected + current.prompt}` 强制重挂载 ③ `draft: string \| null`，null = 未编辑、显示 store 的生效文本 | ① 命中 react-hooks v7 的 `set-state-in-effect`，且每次同步多一次渲染；② 用 key 表达"重置"语义不直观，textarea 会失焦                                                                                 | ③ 换角色 / 保存后把 draft 置回 null 即可，没有 effect、没有二次渲染；`value = draft ?? current?.prompt ?? ''` 一行完成派生                        |
| 世界观草稿回填（保存空串后后端返回默认文本）                         | ① effect 监听 `settings.world_setting` ② 提交后主动 `useSettingsStore.getState().settings` 读一次                                                                                  | ① 同上，还会在用户正在编辑时被外部变化覆盖                                                                                                                                                           | ② 只在自己提交后读一次，语义就是"保存后显示生效文本"                                                                                              |
| 数据管理标签页确认后的去向                                           | ① 关闭整个设置对话框 ② 留在标签页、回到主菜单                                                                                                                                      | 读原 Vue：内嵌模式 `emit('close')` 但父级 `<DataManagerDialog :open="open" embedded />` 没有监听 `@close`，实际行为就是留在页内                                                                      | ② 与原行为一致，且能立刻看到统计行刷新（29 · 0 · 0）                                                                                              |
| 对话管理确认后的时序                                                 | ① `await` 请求完成再关闭 ② 先关闭再发请求                                                                                                                                          | ① 请求期间对话框停在确认页没有任何反馈；原 Pinia 动作是同步的，视觉上就是"点确认即关"                                                                                                                | ② 先 `close()` 再 `await`；失败由 store 内部 toast，与其他动作一致                                                                                |
| 对话管理标题下边距（原 mixin `dc` 为 10px，`DialogShell` 固定 14px） | ① 给 `DialogShell` 加 `titleGap` prop ② 内容容器 `-mt-1` 抵消                                                                                                                      | ① `src/components` 不归本任务，且只有一个调用点需要 10px，不值得加 prop                                                                                                                              | ② 一行 class + 注释说明来源                                                                                                                       |
| 工具栏 E 键隐藏                                                      | ① `hidden` class / `v-show` 等价 ② 条件渲染                                                                                                                                        | 按钮没有内部状态，隐藏与卸载无差别；条件渲染下测试可以直接断言按钮不存在                                                                                                                             | ② `{visible && …}`                                                                                                                                |
| 最大 Token 输入框的状态类型                                          | ① `number`，`onChange` 时 `Number(e.target.value)` ② `string`，保存时解析并收敛到 1–8192                                                                                           | ① 用户清空输入框时 `Number('')` 是 0，会原样交给后端得到 422，`detail` 是 FastAPI 校验数组，toast 出来是一串 JSON                                                                                    | ② 用户输入是真实边界，`clampMaxTokens` 在保存时收敛；受控输入框允许中间态为空                                                                     |
| 设置页按钮                                                           | ① 复用共享 `DialogButton`（胶囊、min-w 132、#f0eeee 底） ② 新建 `SettingsButton`                                                                                                   | 原 `sd__btn` 是 8px 圆角矩形、14px 字、半透明白底 / 黄底，与 dialog-shell 的胶囊按钮是两套外观；但数据管理标签页在原项目里用的正是 dialog-shell 的 `dm__btn` 胶囊                                    | ② 设置页三个表单标签页 + 关于页用 `SettingsButton`；数据管理、对话管理、"请先选中角色卡片"用 `DialogButton`                                       |
| 连接测试的状态表达                                                   | ① `testing: boolean` + `result: PingResult \| null` 两个 state ② 判别联合 `{kind:'idle'} \| {kind:'testing'} \| {kind:'done', result}`                                             | ① 两个字段可以组合出"testing 且有旧 result"这种不该出现的状态                                                                                                                                        | ② 渲染时 `test.kind === 'done'` 直接拿到 `result`，`PingResult` 本身又是判别联合，`ok` 分支里 `error` 类型自明                                    |
| 免责声明列表                                                         | 直接 `<ul>`                                                                                                                                                                        | Tailwind preflight 把 `list-style` 清成 none，原 SCSS 依赖浏览器默认圆点 / 数字                                                                                                                      | 显式 `list-disc pl-5` / `list-decimal pl-6`，已在构建产物里确认 `list-style-type:disc` / `decimal` 生成                                           |

## 2. 遇到的问题

### 2.1 世界观"恢复默认"用例：textarea 一开始就是默认文本

- 现象：`世界观恢复默认时 PATCH 空串并回填默认文本` 失败，`openTab('世界观设定')` 后 textarea 值是"默认世界观"而不是 `setState` 预置的"我的世界观"。
- 定位：断言失败在切换标签后的第一句，说明 store 在世界观页挂载前就被改了；对话框默认打开 AI 配置页，`AiConfigTab` 的 `useEffect` 里有 `loadSettings()`。
- 根因：测试桩 `defaultHandler` 对 `GET /api/settings` 固定返回默认 `SETTINGS`，AI 配置页先挂载、重拉设置，把预置的自定义世界观覆盖掉了。组件行为是对的（重拉是为了让"今日剩余额度"反映最新发送数），是桩没有和预置状态保持一致。
- 修复：该用例的 `GET /api/settings` 也返回 `custom`。
- 验证：用例通过；顺手确认了打开设置对话框会发一次 `GET /api/settings`，这在联调时能在 Network 面板看到。

### 2.2 Prettier 的 Tailwind 排序插件对 `@theme` 令牌无效（复现 frontend-foundation 2.3）

- 现象：`prettier --write` 后 `bg-accent/15 border-accent/30 text-accent whitespace-nowrap rounded border …`，令牌类被排到最前，布局类在后。
- 根因：与 foundation 记录相同（根目录 `.prettierrc` 解析不到 `tailwindcss`，回退到内置 v3 排序）。不在本任务范围，只记录复现。

### 2.3 想做浏览器冒烟但环境不具备

- 现象：`localhost:8000` 与 `:5173` 已被其他会话占用（health 与首页都正常，演示账号可登录），本想直接用它们跑 Playwright 截图核对三个对话框。
- 定位：`python3 -c "import playwright"` 报 `ModuleNotFoundError`；`e2e/` 只有 `package.json` 没有 `node_modules`；`npx --no-install playwright` 提示需要下载 1.63.0。
- 处理：放弃下载浏览器，改为对 `pnpm build` 产物 grep 逐一确认 arbitrary 类都生成（见 §3），像素核对留给 E2E / 主会话联调。

## 3. 实测数据

| 指标               | 数值                                                                                                                                                                                                                                                                | 复现                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 新增用例           | 21 个（Toolbar 5、DeleteConfirmDialog 5、SettingsDialog 11），`vitest run src/features/settings` 1.09 s                                                                                                                                                             | `cd frontend && pnpm exec vitest run src/features/settings` |
| 全量测试           | 15 文件 75 用例全部通过，3.18 s                                                                                                                                                                                                                                     | `pnpm test`                                                 |
| lint / typecheck   | 0 error 0 warning / 通过                                                                                                                                                                                                                                            | `pnpm lint`、`pnpm typecheck`                               |
| 源码规模           | `features/settings/` 16 个文件 1564 行（含已有 `api.ts`、`settingsStore.ts` 与 3 个测试文件）                                                                                                                                                                       | `wc -l src/features/settings/*`                             |
| 构建               | `index.css` 31.36 KB（gzip 7.03）、`index.js` 330.12 KB（gzip 114.87）；构建时 characters agent 的文件已落地，增量不能单独归因于本任务                                                                                                                              | `pnpm build`                                                |
| 产物里确认生成的类 | `data-active`（标签选中）、`group-hover` + `filter:brightness(0) invert(1) brightness(.6)`（工具栏 hover 染灰）、`accent-color`（滑块）、`[&>option]:bg-card-bg`、`max-h-[calc(80vh-95px)]`、`transition-duration:var(--anim-fast)`、`list-style-type:disc/decimal` | `grep -c <pattern> dist/assets/index-*.css` 各为 1          |

## 4. 与原组件的差异（评审时对照）

- 设置对话框标题：原 20px / 600 / 下边距 16px；`DialogShell` 固定 22px / 500 / 14px。关闭钮：原 top 12 right 16、24px、opacity .5；shell 为 28×28 圆形、22px、hover 白层。两者都是共享外壳的既定样式，未覆盖。
- 设置面板 `max-height: 80vh`：外壳没有该约束，用正文容器 `max-h-[calc(80vh-95px)]` 近似（外壳上下 padding 28+20，标题行 33+14）。
- 工具栏没有"分享"按钮：设置按钮的 right 从原 285 移到 210，三个按钮仍按 `TOOLBAR.step = 75` 等距。
- 数据管理标签页：去掉导出 / 导入行、分隔线与"数据 N KB"，只剩统计行 + 三个操作。
- 对话管理的删除禁用 title 改为"该角色只剩这一个会话，无法删除"（原文"该对话是父卡下唯一的子对话"是内部术语）。
- 免责声明照搬原文，其中第一节"所有数据仅存在于本地设备"在有后端后已不准确，按任务要求未改。
- 标签页切换即卸载：同一次打开内切换标签会丢弃未保存草稿（原 Vue 保留在父组件里）。
- 提示词保存失败（store 只 toast 不 reject）后草稿会回到 store 的值，用户的编辑丢失。

## 5. 面试锚点

- `docs/interview.md#settings-draft`：`CharacterPromptTab` 的 `draft: string | null` 派生模式，对比 effect 同步 / key 重挂载（§1 第 2 行）。
