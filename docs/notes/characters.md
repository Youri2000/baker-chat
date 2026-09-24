# 角色主卡与会话子卡（characters）

记录 `frontend/src/features/characters/`（CharacterCardList / CharacterCardItem / SubCard / cardLayout）从 Vue 移植到 React + Tailwind v4 时的选型、问题与实测数据。日期 2026-09-24。

## 1. 技术选型

| 项目                         | 候选                                                                                                                                                                                                                                                                      | 放弃理由                                                                                                                    | 结论                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hover 在主卡与子卡之间传递   | ① 照搬原 Vue：组件内 `hover` 状态 + `pointerleave` 里判断 `relatedTarget` 是否仍在卡内（避免主卡→子卡中间一帧 `hover=null` 闪烁）② 把 hover 写进 chatStore 的 `hoveredCharacterName` ③ 纯 CSS：主卡、子卡各自 `group/card`、`group/sub`，白层 `group-hover/*:opacity-100` | ① 每次指针移动都走 React 状态，且 relatedTarget 逻辑是在补 JS 状态机的缝；② 同样要 re-render，还把纯视觉状态放进全局 store  | ③。主卡与子卡是兄弟元素（子卡容器不在主卡内），浏览器在同一帧内切换两者的 `:hover`，两层白层各自按 0.2s 淡入淡出，天然"平滑传递"，没有闪烁；hover 全程 0 次 React 渲染（见 §3）                                                |
| 选中 / 折叠视觉              | ① `clsx` 按状态拼 class ② `data-selected` / `data-collapsed` 属性 + `group-data-*/name:` 变体                                                                                                                                                                             | ① 每个子元素都要各写一份条件表达式（子卡有 9 个联动元素）                                                                   | ②：状态只在根元素写一次属性，子元素用 `group-data-selected/sub:opacity-0` 之类声明式跟随；已在 `pnpm build` 产物里确认 Tailwind 4.3.3 生成了 `.group-data-selected\/sub\:scale-x-100:is(:where(.group\/sub)[data-selected] *)` |
| 子卡选中黄层                 | ① 原 SCSS 的 `::after` 伪元素 ② 显式 `<span>`                                                                                                                                                                                                                             | Tailwind 的 `after:` 变体能写，但 `after:content-['']` + 十几个 class 塞在父元素上难读                                      | ②：`<span class="absolute inset-0 origin-left scale-x-0 … group-data-selected/sub:scale-x-100">`，用 v4 的 `scale` 独立属性而非 `transform`，`transition-transform` 在 v4 已覆盖 transform/translate/scale/rotate              |
| 折叠动画                     | ① Vue `<transition name="collapse">` 的进入+离开 ② 只做进入动画（`animate-collapse-in`），折叠时直接卸载                                                                                                                                                                  | 离开动画在 React 里要延迟卸载（额外状态或库）                                                                               | ②，与基础设施冻结的令牌一致；离开时主卡块的 `top` 仍有 0.3s 位移过渡，视觉上不突兀                                                                                                                                             |
| 列表布局                     | ① flex/grid 流式布局让浏览器算高度 ② 保留原 `computeUnitTops`：每块 top 由折叠状态 + 子卡数量累加，绝对定位                                                                                                                                                               | ① 折叠/展开时"下方主卡整体位移"的 0.3s 过渡依赖 `top` 数值过渡，流式布局做不到同样效果                                      | ②，`cardLayout.ts` 只保留有调用点的 4 个函数；原 `computeCardPadTop` 的可选参数与 `n === 0` 分支删除（29 张主卡恒定）                                                                                                          |
| 子卡预览里的表情             | ① 原 `emojiToHtml` + `dangerouslySetInnerHTML` ② `splitEmojiText` 切成 `string \| Emoji` 再 map 成节点                                                                                                                                                                    | ① 要先手工转义再拼 HTML，React 里没必要                                                                                     | ②，`<img class="inline-block h-[1em] object-contain align-middle" style="width:{aspect}em">`，与原 `.sns-emoji` 全局样式等价（preflight 把 img 设为 block，必须显式 inline-block）                                             |
| 空会话文案的 "和TA聊聊" 分支 | 照搬三分支                                                                                                                                                                                                                                                                | `CharacterGender` 是 `'male' \| 'female'` 闭合联合，29 个角色都有性别，第三分支不可达（五板斧：不为不可能出现的状态写分支） | 只有两分支：`gender === 'male' ? '和他聊聊' : '和她聊聊'`                                                                                                                                                                      |
| 折叠按钮元素                 | 原 `<button tabindex="-1" aria-hidden>`                                                                                                                                                                                                                                   | 卡片根已是 `role="button"`，里面再放 button 是嵌套交互元素；它本来就 `pointer-events: none` 纯视觉                          | 改为 `<span>`，测试里 `getAllByRole('button')` 也因此干净（折叠时正好 1 个）                                                                                                                                                   |

## 2. 遇到的问题

### 2.1 卡片纹理、装饰、子卡图标全部不显示（宽度为 0）

- 现象：headless Chromium 截图里主卡只有底色，没有斜纹纹理、名字下划线、右上角装饰；子卡图标框是空的，选中后徽标/翼饰也不出现。文字、头像、折叠圆环都正常。
- 定位：用 CDP `Runtime.evaluate` 遍历选中子卡内所有 `<img>`，打印 `getBoundingClientRect()` 与 computed style：7 张图 `height` 都对（68.39 / 71.03 / 25.5 …），`width` 全是 0，`opacity`/`filter`/`display` 都正常，`naturalWidth` > 0 说明图片已加载。
- 根因：Tailwind preflight 有 `img, video { max-width: 100%; height: auto }`。这些 img 的包含块是零尺寸原点容器（`size-0`，原项目的 `.card` / `.subcard` 同样是 0×0），`max-width: 100%` 解析成 0，`w-[434.72px]` 被 max-width 压成 0。原项目的重置没有这条规则，所以 SCSS 版正常。头像 img 是 `w-full` 放在 76px 盒子里、折叠圆环放在 31.2px 的 span 里，所以不受影响。
- 修复：给零尺寸容器里所有带显式宽度的 img 加 `max-w-none`（主卡 5 张、子卡 7 张）。不能改冻结的 `index.css`，也不该为此加全局规则——只有"零尺寸容器内的图片"才受影响。
- 验证：重新截图，所有 img 宽度恢复 434.72 / 137.59 / 48 / 31.5 / 29.19 / 38.13；纹理、下划线、角标、选中徽标都出现。这条和 brief 里"逐项核对 preflight 与原重置差异"是同一类问题（表情 `<img>` 要显式 inline 的兄弟问题）。

### 2.2 headless 冒烟里点击主卡后子卡没出现

- 现象：点击"陈千语"后主卡白层常显、箭头转到 180°（store 已切换），但下面没有子卡，后续主卡也没有下移。
- 定位：后端日志只有 `/api/auth/login`（脚本自己调的），没有浏览器发出的 `/api/auth/me` 和 `/api/conversations`；`frontend/.env` 不存在。
- 根因：占用 5173 的是别的会话启动的 Vite，环境里没有 `VITE_API_BASE_URL`，`API_BASE` 变成字符串 `"undefined/api"`，请求打到 Vite 自己返回 index.html，JSON 解析失败后 `loadConversations` 只 toast，`conversations` 保持 `[]`，主卡展开后自然没有子卡。
- 修复：本次用 `VITE_API_BASE_URL=http://localhost:8000 pnpm vite --port 5174` 另起一个 dev server，后端 `CORS_ORIGINS` 加上 5174。给主会话的建议：按任务说明把 `.env.example` 复制成 `frontend/.env`。
- 验证：后端日志出现 `GET /api/auth/me 200`、`GET /api/conversations 200`，展开后子卡渲染，`section.scroll-mask` 的 `scrollHeight` 为 3084 = 顶部留白 10 + 27 张折叠块 × 100.86 + 陈千语展开块（100.86 + 68.95 + 7.87）+ 最后一张主卡 92.99 + 尾部留白 80 = 3083.89，与 `computeCardPadTop` 的结果一致。

### 2.3 `cardLayout.test.ts` 期望值算错

- 现象：`computeUnitTops([true,true,true],[1,1,1])` 期望 `[10, 110.86, 221.72]`，实际 `211.72`。
- 根因：手算时把第三张的 top 多加了 10（10 + 2×100.86 = 211.72）。
- 修复：改期望值；其余用例统一用 `toBeCloseTo(…, 5)` 避免浮点累加误差。

## 3. 实测数据

### 3.1 各交互触发的组件渲染次数

测量方法：临时测试文件用 `vi.mock` 把 `CharacterCardItem` / `SubCard` 包一层计数器（包装组件直接调用原组件函数），渲染 `CharacterCardList`（29 个角色，陈千语 2 段会话，其余各 1 段），在每步交互后读取计数。数据（已删除临时文件，复现步骤见下）：

| 交互                                                          | CharacterCardItem 渲染 | SubCard 渲染 | 说明                                                                    |
| ------------------------------------------------------------- | ---------------------- | ------------ | ----------------------------------------------------------------------- |
| 首次挂载                                                      | 29                     | 0            | 全部折叠                                                                |
| 指针进入/离开主卡（pointerenter / mouseover / pointerleave）  | 0                      | 0            | hover 完全由 CSS `:hover` 承担                                          |
| 点击"陈千语"展开（2 张子卡）                                  | 29                     | 2            | `tops` 是新数组，列表重渲染，29 张全部重跑                              |
| 指针进入/离开子卡                                             | 0                      | 0            | 同上                                                                    |
| 单击子卡（同步部分：设置 activeConversationId）               | 0                      | 1            | 子卡用 `s.activeConversationId === id` 布尔选择器，只有翻转的那张重渲染 |
| 子卡消息重拉完成（`conversations` 被 `withLastMessage` 替换） | 29                     | 3            | 列表订阅 `conversations`，新数组 → 全部主卡重渲染                       |
| 切到同角色另一张子卡（含重拉）                                | 29                     | 4            | 2 张子卡各翻转一次 + 重拉后各 1 次                                      |
| 展开第 1 张主卡                                               | 29                     | 3            | 后面 28 张的 top 本来就要变                                             |
| 展开第 29 张主卡                                              | 29                     | 4            | 只有它自己的块变化，但仍然 29 次：`groups` / `tops` 都是新数组          |
| `store.setHoveredCharacter('陈千语')`                         | 0                      | 0            | 该字段没有任何订阅者                                                    |

结论与代价：hover 与子卡选中已经是最小粒度（0 / 1 次）；"展开末尾主卡也重渲染 29 张"是当前唯一的浪费，若要压到 1 次需要 `useMemo` 缓存分组 + `memo(CharacterCardItem)`，代价是 29 张卡的 props 比较与代码复杂度。每张主卡只有 16 个 DOM 节点、每次重渲染没有布局计算，React 协调 29 张卡在毫秒级，当前没有实测到卡顿，所以没做（可作为面试"可改进之处"）。

复现：在 `frontend/src/features/characters/` 新建 `xx.test.tsx`，`vi.mock('@/features/characters/SubCard', async (orig) => ({ SubCard: (p) => { count++; return (await orig()).SubCard(p); } }))`，`render(<CharacterCardList />)` 后用 `fireEvent` 逐步交互并打印计数。

### 3.2 DOM 与产物

| 指标                                                      | 数值                                                                | 复现                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| 单张折叠主卡的 DOM 节点数（含位移用的块容器）             | 16                                                                  | 3.3 的 CDP 脚本在页面里 `querySelectorAll('*')` 计数  |
| 单张子卡的 DOM 节点数                                     | 14（无表情时）                                                      | 同上                                                  |
| 28 张折叠 + 1 张展开（1 子卡）时列表内节点总数 / 其中 img | 480 / 239                                                           | 同上；29×16 + 子卡容器 1 + 子卡 14 + 尾部留白 1 = 480 |
| `pnpm test`（整个前端）                                   | 17 文件 84 用例通过，其中 characters 4 文件 13 用例                 | `cd frontend && pnpm test`                            |
| `pnpm lint` / `pnpm typecheck`                            | 通过                                                                | `pnpm lint && pnpm typecheck`                         |
| `pnpm build` 产物 CSS                                     | 31.36 kB（gzip 7.03 kB），含其他 agent 同期加入的样式，不能单独归因 | `pnpm build`                                          |

### 3.3 视觉核对方法（无 Playwright 依赖）

`e2e/` 还没装 Playwright，但 `~/Library/Caches/ms-playwright/chromium-1234` 里有 Chrome for Testing。写了一个 CDP 脚本（Node 22 自带 `WebSocket` 与 `fetch`）：用 `--remote-debugging-port` 启动 headless Chrome → 调后端 `/api/auth/login` 拿 token → `localStorage.setItem('baker.token', …)` → 进 `/` → `Input.dispatchMouseEvent` 点击主卡、悬停子卡、点击子卡 → `Page.captureScreenshot`（含 `clip` 裁出 0,122.57,526×897.27 的列表区）。四张截图（折叠 / 展开+主卡 hover / 子卡 hover / 子卡选中）与原项目对照：纹理、下划线、角标位置、黄层、暗色徽标、底部渐隐一致。后端用 `AI_MOCK=1` + 临时 SQLite 启动。

## 4. 留给主会话 / 其他 agent 的注意点

- `chatStore` 的 `hoveredCharacterName` / `setHoveredCharacter` 没有任何消费者（hover 全在 CSS）；按五板斧应删除，chatStore 属于 chat feature，本任务未改。
- 零尺寸原点容器里的 `<img>` 一律要加 `max-w-none`（preflight `max-width: 100%`），聊天区的气泡 / 装饰图如果用同样的绝对定位结构会踩同一个坑。
- 子卡预览的表情渲染（`splitEmojiText` → `<img inline-block h-[1em]>`）与聊天气泡是同一逻辑；等气泡实现后是第二个调用点，可提到 `src/components/EmojiText.tsx`。
- `frontend/.env` 缺失时 dev server 的 `API_BASE` 是 `undefined/api`，主页能进但列表为空，不报错只 toast。
