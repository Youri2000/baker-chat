# 可量化的优化与度量（measurements）

记录字体子集化、流式重渲染次数、产物体积对比三项实测数据，以及两个要等真实 DeepSeek Key 才能出数据的脚本（首个气泡时间、prompt_tokens 曲线）的写法与 AI_MOCK=1 试跑记录。脚本在 `scripts/measure/`，度量用例在 `frontend/src/features/chat/rerender.measure.test.tsx`。日期 2026-09-24。

测量环境：macOS（Apple Silicon）、Node 22.22.2、pnpm 9.12.0、Python 3.13.5、fonttools 4.66.0 + brotli 1.2.0（scratch 目录临时 venv）、Playwright 1.62.1（e2e 工作区）+ 其自带 Chromium 151.0.7922.34（缓存 revision 1234）、后端 `AI_MOCK=1` 跑在 8022、前端 `vite preview` 跑在 5182。

## 1. 技术选型

| 项目                      | 候选                                                                                                                                                       | 放弃理由                                                                                                                                      | 结论                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 子集化工具                | ① `pyftsubset` 命令行 + 临时 `--text-file` ② `fontTools.subset` Python API 进程内调用 ③ glyphhanger（爬页面取字符）                                        | ① 要先把 7 千个字符落成临时文件再传路径；③ 依赖 Node + puppeteer，且只能拿到静态页面上出现的字，拿不到 AI 会生成的字                          | ② `Subsetter.populate(text=…)` 一次传入，脚本同时能读 cmap 报告"字体里没有而被跳过的字符"（实测只有 ⚠✅💡 三个 emoji）             |
| 子集字符范围              | ① 只取项目文本出现过的字符（3,054 个）② ① + GB2312 一、二级汉字（7,064 个）③ 整个 GBK / 全量（29,063 个）                                                  | ① 实测 365,556 B，但用户输入和 AI 回复里 6,763 个常用字只覆盖 2,758 个，气泡里会频繁出现 HarmonyOS 与 PingFang 混排；③ 就是现状 4.32 MB       | ②：928,912 B（−78.5%），常用字全覆盖，角色名和提示词里的生僻字（GB2312 之外的 40 个字符）另外并入；更生僻的字回退系统字体          |
| 子集文件命名              | ① 原名覆盖 ② 新名 `*.subset.woff2` 并删除原文件                                                                                                            | ① 看文件名分不出是否子集，`@font-face` 也不用改，评审看不到变化                                                                               | ②：`index.css` 的 `src` 指向新名，原文件只在只读的 `endfield-baker-chat/src/assets/fonts/` 保留                                    |
| 首个气泡计时点            | ① Playwright 在 Node 里轮询 `waitForSelector`（chat.md 冒烟的做法，328 ms）② 页面内 `keydown` 监听 + `MutationObserver` 记 `performance.now()`             | ① 包含 Playwright 轮询间隔与进程间往返，测到的是"脚本看到"而不是"DOM 出现"                                                                    | ②：三个时刻都在页面内取，Node 只负责等 `t2 > 0` 再读回；同一 mock 后端下首个气泡 168 ms                                            |
| "全文完成"（t2）的判定    | ① `page.on('response')` + `response.finished()`（网络层收到 `[DONE]`）② 加载气泡（`role=status`）从 DOM 消失（前端处理完 `[DONE]`、`pending=false`）       | ① 与 t0/t1 不在同一时钟（Node 时钟 vs 页面 `performance.now()`），要换算                                                                      | ②：同一时钟、同一 observer；语义正是"原项目等全文再显示"时用户能看到第一句话的时刻                                                 |
| 排除加载气泡              | 直接数 `rect.fill-bubble-other`                                                                                                                            | `LoadingBubble` 的 rect 也带 `fill-bubble-other`，加载气泡出现就会被误判为首个文字气泡                                                        | 选择器 `svg:not([role="status"]) > rect.fill-bubble-other`                                                                         |
| Playwright 依赖来源       | ① `scripts/measure` 自带 `package.json` 再装一份 ② 从 e2e 工作区 `createRequire('../../e2e/package.json')('@playwright/test')`                             | ① 不在 pnpm workspace 里，会多一份 lockfile 与浏览器下载                                                                                      | ②：`@playwright/test` 重导出了 `chromium`，浏览器也复用 e2e 的缓存                                                                 |
| ChatBubble 渲染计数       | ① React DevTools Profiler 手工看 ② why-did-you-render ③ `vi.mock` 把 `ChatBubble` 换成计数包装：`memo(fn)` 对象的 `.type` 就是原函数，包一层 `memo` 或不包 | ① 不能进 CI；② 额外依赖且只报告"不必要"的渲染，不给总数                                                                                       | ③：同一份原组件代码在两种包装下各跑一遍，差异只来自 `memo`；commit 数用 `<Profiler onRender>` 计                                   |
| 30 帧 delta 的推送方式    | ① 一次性 enqueue 全部帧 ② 真实定时器隔 15 ms 推一帧 ③ 每帧一次 `await act(async () => sse.push(frame))`                                                    | ① React 自动批处理会把多次 `set` 合成一次提交，commit 数失真；② setTimeout 与 Scheduler 的 MessageChannel 任务顺序在 jsdom 里不保证，数字会抖 | ③：act 在回调 resolve 后冲刷队列，一帧一提交；重拉请求挂在手动 gate 上，"关加载气泡"与"替换为持久化消息"像真实网络一样落在两次提交 |
| prompt_tokens 脚本的 HTTP | ① 后端 venv 的 httpx ② 标准库 `urllib`                                                                                                                     | ① 脚本要依赖某个 venv 才能跑                                                                                                                  | ②：`for raw in resp` 逐行读分块响应即可解析 SSE，任何 python3 直接运行                                                             |
| gzip 级别                 | `gzipSync` 默认级别（zlib 6）/ 9                                                                                                                           | Vite 构建报告用的就是默认级别，用 9 会与它对不上                                                                                              | 默认级别；`bundle-size.mjs` 的 KB 是 1024 进制（Vite 报告的 kB 是 1000 进制，所以 928.91 kB = 907.1 KB）                           |

## 2. 字体子集化

### 2.1 方法

`scripts/measure/subset-font.py`（fontTools API）。字符集 = ASCII 可打印（95）+ GB2312 A1 区标点、A3 区全角 ASCII + GB2312 B0–F7 区汉字（6,763）+ `frontend/src/**/*.{ts,tsx,css}`、`frontend/index.html`、`backend/app/characters.py`、`backend/app/data/character_prompts.json` 里出现的全部字符（含注释，是安全的超集）。去重后 7,064 个字符，字体里没有的 ⚠✅💡 被跳过，最终 cmap 7,060 个码位、7,061 个字形（含 .notdef）。脚本单机耗时 21 s（13 s user）。

复现：

```bash
python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
/tmp/fontenv/bin/python scripts/measure/subset-font.py \
  endfield-baker-chat/src/assets/fonts/HarmonyOS_Sans_SC_Medium.woff2 \
  frontend/src/assets/fonts/HarmonyOS_Sans_SC_Medium.subset.woff2
```

### 2.2 数据

| 指标                                       | 子集前（全量）                                                                  | 子集后                                     | 变化                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| 文件大小                                   | 4,319,844 B（4.12 MiB / Vite 报 4.32 MB）                                       | 928,912 B（907.1 KiB / Vite 报 928.91 kB） | −3,390,932 B（−78.5%）                                             |
| gzip -9 / brotli 后（传输大小）            | 4,288,878 B / 4,287,156 B                                                       | 929,212 B / 928,917 B                      | woff2 内部已是 brotli，再压无收益                                  |
| 字形数 / cmap 码位                         | 29,221 / 29,063                                                                 | 7,061 / 7,060                              | −75.8% / −75.7%                                                    |
| 表                                         | OS/2 cmap glyf head hhea hmtx loca maxp name post                               | 同左                                       | 没有 GSUB/GPOS/fpgm/prep，无需 `--layout-features`、`--no-hinting` |
| `pnpm build` 产物合计（`bundle-size.mjs`） | 4,968.1 KB（由本次 1,656.6 − 907.1 + 4,218.6 推算，子集前的 dist 只有字体不同） | 1,656.6 KB（gzip 1,396.3 KB）              | −66.7%                                                             |
| 备选：只取项目文本字符                     | —                                                                               | 365,556 B（3,054 字符 / 3,051 字形）       | 常用字只覆盖 2,758/6,763，放弃                                     |

### 2.3 浏览器回退验证

方法：`vite preview --port 5182` 打开 `/login`，用 Playwright 在页面里插入 `<span>陈喆</span>`（陈在子集内；喆 U+5586 是 GBK 字，全量字体有、子集没有，已用 fontTools 读 cmap 确认），等 `document.fonts.ready` 后用 CDP `CSS.getPlatformFontsForNode` 看每个字形实际由哪个平台字体绘制（脚本在 scratchpad `font-probe.mjs`，核心 20 行：`newCDPSession` → `DOM.getDocument` → `DOM.querySelector` → `CSS.getPlatformFontsForNode`）。

| 字体栈                                                                | 平台字体（glyphCount）                                                                    | 结论                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `var(--font-bubble)`（项目实际栈）                                    | HarmonyOS Sans SC Medium（web 字体，isCustomFont=true）1 + HarmonyOS Sans SC（本机安装）1 | 喆 由栈里第二个字体绘制，不是方块                     |
| `'HarmonyOS Sans SC Medium', sans-serif`（无本机 HarmonyOS 时的情形） | HarmonyOS Sans SC Medium 1 + PingFang SC Regular 1                                        | 没装 HarmonyOS 的机器回退到系统中文字体，同样不是方块 |

网络面板只请求了 `HarmonyOS_Sans_SC_Medium.subset-BDKgqRiI.woff2`（200），`document.fonts.check('40px "HarmonyOS Sans SC Medium"')` 为 true。浏览器按字符逐个回退是 CSS 字体匹配的标准行为，只要栈末有 `sans-serif` 就不会出现 .notdef 方块。

## 3. 流式过程中的重渲染次数

用例：`frontend/src/features/chat/rerender.measure.test.tsx`，随 `pnpm test` 运行；断言只有"挂载渲染 = 20"与"memo 版 ≤ 对照版"，数字打印到 stdout（`pnpm exec vitest run src/features/chat/rerender.measure.test.tsx --reporter=verbose` 可见）。

场景：`<Profiler>` 包住 `<ChatArea>`，20 条历史消息（我方 / 对方交替）→ `chatStore.sendMessage` 走真实的 fetch + `streamSse` 路径 → 推 30 帧 delta（10 行，每行切 3 段，第 3 段带 `\n`，所以每 3 帧固化一个气泡）→ `[DONE]` → 放行重拉请求。`ChatBubble` 用 `vi.mock` 换成计数包装：memo 版 = `memo(Counted)`，对照版 = `Counted`，`Counted` 内部都调用原组件函数（`memo(fn)` 对象的 `.type`）。

| 指标                                     | memo 版 | 对照版（去掉 memo） |
| ---------------------------------------- | ------- | ------------------- |
| Profiler commit 次数                     | 14      | 14                  |
| ChatBubble 渲染：挂载 20 条历史          | 20      | 20                  |
| ChatBubble 渲染：发送 → 30 帧 → 重拉完成 | 11      | 348                 |

解读：14 次提交 = 挂载 1 + 乐观追加我方消息 1 + 10 行各 1 + 关加载气泡 1 + 重拉替换 1；30 帧里 20 帧没凑成整行，`pushBubbles` 不写 store，不产生提交。memo 版的 11 = 我方消息 1 + 10 个新气泡各挂载 1 次，已有气泡的 props（`side`、`text`、`animate`）都是原始值，全部跳过；重拉时下标 key 让临时气泡原位换成持久化消息，`text` 相同也跳过。对照版每次提交都重跑列表里全部气泡：21 + (22+…+31) + 31 + 31 = 348，是 memo 版的 31.6 倍；对话越长差距越大（每行的代价是 O(已有行数)）。

桩说明：

- `ResizeObserver` 桩不回调（jsdom 没有布局），气泡始终按加载尺寸绘制。真实浏览器里每个新气泡首帧后会收到一次测量回调并 `setInner`，自身多渲染 1 次，两组各 +11，比例不变。
- `requestAnimationFrame` 桩为空，`LoadingBubble` 的 clip-path 展开（双 rAF 后 `setExpanded`）不触发；真实浏览器里它是加载气泡子树的 1 次额外提交，与气泡渲染次数无关，桩掉是为了 commit 数在 CI 里稳定。
- 测试不套 `StrictMode`；`main.tsx` 的 `StrictMode` 只在开发模式让渲染函数双调，生产构建与此表一致。

复现：`cd frontend && pnpm exec vitest run src/features/chat/rerender.measure.test.tsx --reporter=verbose`（0.13 s）。

## 4. 产物体积对比

`node scripts/measure/bundle-size.mjs`（默认比较 `endfield-baker-chat/dist` 与 `frontend/dist`，先 `pnpm build`）。KB 为 1024 进制。

| 类别 | Vue 版原始           | Vue 版 gzip | React 版原始         | React 版 gzip | 原始差值             |
| ---- | -------------------- | ----------- | -------------------- | ------------- | -------------------- |
| JS   | 722.8 KB             | 297.1 KB    | 358.2 KB             | 130.8 KB      | −364.5 KB（−50.4%）  |
| CSS  | 37.5 KB              | 6.2 KB      | 40.7 KB              | 8.4 KB        | +3.2 KB（+8.4%）     |
| 字体 | 4218.6 KB            | 4188.4 KB   | 907.1 KB             | 907.4 KB      | −3311.5 KB（−78.5%） |
| 图片 | 358.5 KB             | 357.9 KB    | 349.7 KB             | 349.2 KB      | −8.7 KB（−2.4%）     |
| HTML | 0.6 KB               | 0.4 KB      | 0.8 KB               | 0.5 KB        | +0.1 KB              |
| 合计 | 5338.0 KB（82 文件） | 4850.0 KB   | 1656.6 KB（80 文件） | 1396.3 KB     | −3681.4 KB（−69.0%） |

差异来源（都是 `wc -c` 实测）：

- JS −364.5 KB：原项目把 29 个角色提示词打进前端（`src/constants/prompts.ts` 2,966 行、393,586 B，占 Vue 版 JS 740,101 B 的 53%），现在只在后端 `character_prompts.json`；去掉的依赖 jszip（min 97,630 B）、html-to-image（20,562 B）、lz-string（4,814 B）。React 19 运行时比 Vue 3 大：`react-dom/cjs/react-dom-client.production.js` 625,168 B（未压缩）对 `vue.runtime.esm-browser.prod.js` 108,998 B（已压缩），基准不同不能直接相减，但足以说明为什么 JS 净减少（364.5 KB）小于"提示词 384.4 KB + 依赖 120.1 KB"之和；两个运行时在各自产物里的精确占比未测。
- CSS +3.2 KB：Tailwind v4 preflight + `@theme static` 全量输出令牌（frontend-foundation 记录：static 多 2.2 KB）；原 SCSS 只输出用到的规则。
- 字体 −3311.5 KB：第 2 节。
- 图片 −8.7 KB：剔除导出 / ZIP / 背景上传 / 移动端专用的 18 张素材，新增登录页无图；两边都是 webp 直出。
- gzip 视角：合计 4,850.0 → 1,396.3 KB（−71.2%），其中字体不可压缩，是首屏传输量的决定项：子集前字体占传输总量 86%，子集后 65%。

## 5. 需要真实 DeepSeek Key 的两个脚本

两个脚本都已用 `AI_MOCK=1` 试跑通过，数据留待主会话配置 Key 后运行；启动方式（端口按需替换）：

```bash
# 后端（scratch SQLite，mock 或真实 Key 二选一）
cd backend && JWT_SECRET=<32字节以上> CORS_ORIGINS=http://localhost:5182 DATABASE_URL=sqlite:////tmp/measure.db \
  AI_MOCK=1 .venv/bin/uvicorn app.main:app --port 8022      # 真实 Key：去掉 AI_MOCK，设 DEEPSEEK_API_KEY
# 前端（VITE_API_BASE_URL 在构建期烘进产物）
cd frontend && VITE_API_BASE_URL=http://localhost:8022 pnpm build && pnpm exec vite preview --port 5182 --strictPort
```

### 5.1 `scripts/measure/first-bubble.mjs`

流程：接口登录拿 token → `addInitScript` 写入 `localStorage['baker.token']` → 接口为角色新建空会话 → 打开 `/`，`dispatchEvent('click')` 展开主卡并点该角色最后一张子卡（零尺寸 `role=button`，Playwright 认为不可见，沿用 chat.md 的做法）→ 每轮先在页面内装探针（输入框 `keydown` 捕获阶段记 t0；`MutationObserver` 记第一个 `svg:not([role="status"]) > rect.fill-bubble-other` 出现为 t1、`[role="status"][aria-label="正在回复"]` 出现后消失为 t2）→ `fill` + `Enter` → `waitForFunction(t2 > 0)` 读回 → 重复 `--runs` 次取中位数 → 删除该会话。

AI_MOCK=1 试跑（5 轮，3.9 s）：

| 轮次   | 首个气泡 t1−t0 | 全文完成 t2−t0        |
| ------ | -------------- | --------------------- |
| 1      | 173 ms         | 578 ms                |
| 2      | 167 ms         | 579 ms                |
| 3      | 168 ms         | 579 ms                |
| 4      | 168 ms         | 573 ms                |
| 5      | 167 ms         | 576 ms                |
| 中位数 | 168 ms         | 578 ms（提前 410 ms） |

与 mock 的时序吻合：后端每 80 ms 发 5 个字，第一个 `\n` 在第 2 块（160 ms）里，7 块共 560 ms；剩余 8–18 ms 是 SSE 转发、解析和 React 提交。真实 DeepSeek 下 t1 主要由上游首 token 延迟 + 第一行长度决定，t2 由全文长度决定，两者差值才是"流式按行"相对"等全文"的收益。

复现：`node scripts/measure/first-bubble.mjs --base http://localhost:5182 --api http://localhost:8022 --user demo --password demo123 --character 陈千语 --prompt "请用三句话介绍一下你自己" --runs 5`

### 5.2 `scripts/measure/prompt-tokens.py`

流程：登录 → `POST /api/conversations` 新建会话 → 连续发送 N 条 `第 i 条：请用一句话回复我。` → 逐行读 SSE，取 `usage` 帧的 `prompt_tokens` → 打印第 1、10、20、40、50、60 条的值与完整 CSV 曲线 → `finally` 里删除会话。4xx/5xx（含 429 今日额度已用完）直接打印 detail 退出。

AI_MOCK=1 试跑：60 条 35.5 s，全部记为 `-`（mock 流没有 usage 帧，符合契约），后端日志 65 次 `POST …/chat 200`（含 first-bubble 的 5 次），两次 `POST /api/conversations 201` 各对应一次 `DELETE 204`。

预期形态：上下文窗口是 40 条 `ContextEntry`（用户 + 助手各算一条），第 k 条请求带 `2k−1` 条历史，第 20 条时 39 条、第 21 条起被截到 40 条，所以曲线应从第 21 条起趋于平稳（不是第 40 条）；平稳值 ≈ 固定 system（后端 notes 粗估 4.9k token）+ 20 轮问答。每日额度 100 条，60 + first-bubble 的 5 次能在同一天跑完，前提是演示账号当天没有其他消耗。

复现：`python3 scripts/measure/prompt-tokens.py --api http://localhost:8022 --user demo --password demo123 --character 陈千语 --count 60`

## 6. 遇到的问题

### 6.1 ruff D301：文件 docstring 里的命令行续行符

- 现象：`ruff check --config backend/pyproject.toml scripts/measure/` 报 `D301 Use r""" if any backslashes in a docstring`。
- 根因：docstring 里写了 shell 续行 `\\`，D 规则要求含反斜杠的 docstring 用 raw 字符串。
- 修复：把复现命令改成"命令 + 两行参数说明"，不用续行符（改成 `r"""` 会让整段中文 docstring 风格与其他文件不一致）。
- 验证：两个 Python 脚本 `ruff check`（默认规则与后端配置各一次）与 `ruff format --check` 都通过。

### 6.2 `tsc -b` 报 memo 组件没有 `.type`

- 现象：vitest 用例通过，但 `pnpm build` 的 `tsc -b` 报 `TS2339: Property 'type' does not exist on type 'NamedExoticComponent<ChatBubbleProps>'`。
- 定位：vitest 不做类型检查；React 19 的 `memo` 重载对函数组件返回 `NamedExoticComponent<P>` 而不是 `MemoExoticComponent<T>`，后者才声明了 `type`。
- 根因：运行时 `memo()` 返回的对象一直有 `type` 字段（React 内部靠它取原函数），只是类型声明没暴露。
- 修复：`original.ChatBubble as unknown as { type: (props) => ReactElement }` 并注释原因。
- 验证：`pnpm typecheck`、`pnpm build` 通过，用例数字不变。

### 6.3 vitest 默认 reporter 在管道里看不到 `console.log`

- 现象：`pnpm exec vitest run … | tail`，输出只有测试汇总，用例里打印的表格不见了。
- 定位：换 `--reporter=verbose` 后出现 `stdout | src/features/chat/rerender.measure.test.tsx > …` 段落。
- 处理：notes 里的复现命令带 `--reporter=verbose`；数据本身仍以断言兜底（memo ≤ 对照）。

### 6.4 加载气泡的 rect 与文字气泡同 class

- 现象：设计探针时数 `rect.fill-bubble-other`，读 `LoadingBubble.tsx` 发现它的 rect 也带 `fill-bubble-other`，t1 会在加载气泡出现（Enter 后约 20 ms）时被误触发。
- 修复：选择器加 `svg:not([role="status"])`，利用加载气泡的 `role="status"`。
- 验证：mock 下 t1 = 168 ms（第 2 块），而不是加载气泡出现的时刻。

### 6.5 `pnpm exec prettier --check` 对 `bundle-size.mjs` 报格式

- 现象：一行 `console.log(row([...]))` 超过 printWidth 100。
- 修复：`prettier --write`；之后 `scripts/measure` 与 `docs/notes` 检查通过。

## 7. 检查结果

| 命令                                                                              | 结果                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cd frontend && pnpm lint`                                                        | 0 error 0 warning                                                                       |
| `pnpm typecheck`                                                                  | 通过                                                                                    |
| `pnpm test`                                                                       | 19 文件 97 用例通过，3.19 s（含新增度量用例 1 个）                                      |
| `pnpm build`                                                                      | ✓ 587 ms；字体 928.91 kB、CSS 41.69 kB（gzip 8.62）、JS 366.84 kB（gzip 133.93）        |
| `backend/.venv/bin/ruff check [--config backend/pyproject.toml] scripts/measure/` | All checks passed（默认规则与含 D 规则各一次）；`ruff format --check` 2 files formatted |
| `pnpm exec prettier --check scripts/measure docs/notes`                           | All matched files use Prettier code style                                               |
| `node scripts/measure/bundle-size.mjs`                                            | 第 4 节表格                                                                             |
| `node scripts/measure/first-bubble.mjs …`（AI_MOCK=1）                            | 5 轮完成，中位数 168 / 578 ms                                                           |
| `python3 scripts/measure/prompt-tokens.py --api http://localhost:8022 --count 60` | 60 条完成、会话已删除，usage 全为 `-`（mock 无 usage 帧）                               |

## 8. 留给 docs/interview.md 的锚点

- `#font-subset`：字体子集化（`index.css` @font-face 注释已指向）。
- `#rerender-memo`：`memo(ChatBubble)` + 下标 key 的重渲染数据（第 3 节；`ChatBubble.tsx` 现有注释可补锚点）。
- `#bundle-size`：提示词移到后端 + 去依赖 + 子集化的产物对比（第 4 节；`characters.py` 的 `#prompts-backend` 可引用同一表）。
- `#first-bubble`、`#prompt-tokens`：两份等真实 Key 的数据，脚本与复现命令在第 5 节。
