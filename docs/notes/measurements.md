# 可量化的优化与度量（measurements）

记录字体子集化、流式重渲染次数、产物体积对比三项实测数据，以及两个要等真实 DeepSeek Key 才能出数据的脚本（首个气泡时间、prompt_tokens 曲线）的写法与 AI_MOCK=1 试跑记录。脚本在 `scripts/measure/`，度量用例在 `frontend/src/features/chat/rerender.measure.test.tsx`。日期 2026-09-24；第 10 节（聊天区滚动、按需加载与长会话的前后对比）与第 3 节末的重测为 2026-09-28；第 11 节（打字机）以及第 3 节末、5.1 的补充说明为 2026-09-29。

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

用例：`frontend/src/features/chat/rerender.measure.test.tsx`，随 `pnpm test` 运行；断言"挂载渲染 ≤ 20"与"memo 版的渲染次数、提交次数 ≤ 对照版"（挂载一项原为"= 20"，虚拟化后放宽，见本节末），数字打印到 stdout（`pnpm exec vitest run src/features/chat/rerender.measure.test.tsx --reporter=verbose` 可见）。

场景：`<Profiler>` 包住 `<ChatArea>`，20 条历史消息（我方 / 对方交替）→ `chatStore.sendMessage` 走真实的 fetch + `streamSse` 路径 → 推 30 帧 delta（10 行，每行切 3 段，第 3 段带 `\n`，所以每 3 帧固化一个气泡）→ `[DONE]` → 放行重拉请求。`ChatBubble` 用 `vi.mock` 换成计数包装：memo 版 = `memo(Counted)`，对照版 = `Counted`，`Counted` 内部都调用原组件函数（`memo(fn)` 对象的 `.type`）。

| 指标                                     | memo 版 | 对照版（去掉 memo） |
| ---------------------------------------- | ------- | ------------------- |
| Profiler commit 次数                     | 14      | 14                  |
| ChatBubble 渲染：挂载 20 条历史          | 20      | 20                  |
| ChatBubble 渲染：发送 → 30 帧 → 重拉完成 | 11      | 348                 |

解读：14 次提交 = 挂载 1 + 乐观追加我方消息 1 + 10 行各 1 + 关加载气泡 1 + 重拉替换 1；30 帧里 20 帧没凑成整行，不写 store，不产生提交。memo 版的 11 = 我方消息 1 + 10 个新气泡各挂载 1 次，已有气泡的 props（`side`、`text`、`animate`）都是原始值，全部跳过；重拉时下标 key 让临时气泡原位换成持久化消息，`text` 相同也跳过。对照版每次提交都重跑列表里全部气泡：21 + (22+…+31) + 31 + 31 = 348，是 memo 版的 31.6 倍；对话越长差距越大（每行的代价是 O(已有行数)）。

桩说明：

- `ResizeObserver` 桩不回调（jsdom 没有布局），气泡始终按加载尺寸绘制。真实浏览器里每个新气泡首帧后会收到一次测量回调并 `setInner`，自身多渲染 1 次，两组各 +11，比例不变（引入虚拟列表前的推算）。
- `requestAnimationFrame` 桩为空，`LoadingBubble` 的 clip-path 展开（双 rAF 后 `setExpanded`）不触发；真实浏览器里它是加载气泡子树的 1 次额外提交，与气泡渲染次数无关，桩掉是为了 commit 数在 CI 里稳定。
- 测试不套 `StrictMode`；`main.tsx` 的 `StrictMode` 只在开发模式让渲染函数双调，生产构建与此表一致。

复现：`cd frontend && pnpm exec vitest run src/features/chat/rerender.measure.test.tsx --reporter=verbose`（0.13 s）。

**引入虚拟列表后（2026-09-28 重测）**：Profiler commit 26 次（两组相同）；ChatBubble 渲染 memo 版挂载 7 + 发送 → 重拉完成 12，对照版挂载 14 + 146。挂载的第一次提交只渲染末尾附近的行，所以挂载数小于 20；提交次数增加来自虚拟列表的测量回调（新行挂载后被测量，测量结果变化让列表再提交一次），逐项来源未单独拆分；对照版减少是因为每次提交只重跑已渲染的行。测试环境让 `offsetHeight` 返回内联 style 的高度（`src/test/setup.ts`），否则 jsdom 里虚拟列表一行都不渲染；用例断言相应放宽为"挂载渲染 ≤ 20"。

**加入打字机后（2026-09-29）**：这个用例以整行模式运行（`sendMessage(QUESTION, false)`），数字与上一段相同（26 次提交，memo 7 + 12，对照 14 + 146）；同一文件的第二个用例测打字机开启时的渲染，见第 11 节。

## 4. 产物体积对比

`node scripts/measure/bundle-size.mjs`（默认比较 `endfield-baker-chat/dist` 与 `frontend/dist`，先 `pnpm build`）。KB 为 1024 进制。下表是 2026-09-24（提交 5fcec89）的数据；之后到按需加载改动前还有几次前端提交，按需加载改动前后的同口径对比见 10.3。

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

> 加入打字机（2026-09-29，默认开启）后，t1 在第一行出现第一个字时就触发；同一次提交里加载气泡就消失，t2 与 t1 几乎相同，不再表示全文完成。要复现本节与第 9.2 节的数字，先在设置"AI 配置"里关闭打字机效果。

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
- `#typewriter`：第 11 节的打字机渲染与帧时长数据（技术亮点，`typewriter.ts` 的 💡 注释已指向）。
- `#entry-chunk`、`#long-list`：第 10 节的首屏按需加载与长会话数据；对应的技术亮点 `#lazy-preload`、`#virtual-list`、`#auto-scroll` 已由 `lazyWithPreload.tsx`、`MessageList.tsx`、`useChatAutoScroll.ts` 的 💡 注释指向。

## 9. 真实 DeepSeek 数据（2026-09-24，主会话补测）

后端配真实 Key（`deepseek-flash`，`https://api.deepseek.com`），前端 `pnpm build` 后 `vite preview` 在 5182，后端 8030，临时 SQLite，本机网络直连（不走代理）。

### 9.1 发现：V4 系列默认开启思考模式，流式分段失效

**现象**：第一次跑 `first-bubble.mjs`（后端尚未关闭思考），5 轮首个气泡 5756 / 4926 / 1407 / 5017 / 5029 ms，全文完成 5757 / 4926 / 1407 / 5017 / 5030 ms——首个气泡和全文几乎同时出现，中位数都是 5017 ms，"流式按行"对首句毫无提升。

**定位**：直接用 httpx 请求上游（`max_tokens: 300`，`stream: true`），逐帧记录 delta 类型与到达时间：

| 请求参数                         | 帧统计                                    | 首个 content 帧 | [DONE]  | usage                              |
| -------------------------------- | ----------------------------------------- | --------------- | ------- | ---------------------------------- |
| 默认（不传 thinking）            | `reasoning_content` × 300，`content` × 0  | 无              | 2056 ms | completion 300，其中 reasoning 300 |
| `reasoning_effort: "low"`        | `reasoning_content` × 271，`content` × 28 | 1945 ms         | 1948 ms | completion 300，其中 reasoning 271 |
| `thinking: {"type": "disabled"}` | `content` × 46                            | 765 ms          | 1127 ms | completion 46                      |

**根因**：`deepseek-flash`（V4.1 Flash）默认开启思考模式（官方文档 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)）。思考 token 计入 `max_tokens`：预算小时正文直接为空；正文要等思考结束后才开始，而且实测 28 个 content delta 在 3 ms 内到达——答案是整段一次性吐出的，前端按行分段自然全部落在最后一刻。角色闲聊不需要推理，思考只带来延迟和费用。

**修复**：后端请求体加 `"thinking": {"type": "disabled"}`（`backend/app/ai.py`，`ping` 同样关闭），`docs/api.md` §3 同步，测试断言该字段。

**验证**：见 6.2；直连上游对比：首个正文 1945 ms → 765 ms，completion token 300 → 46。

### 9.2 首个 AI 气泡出现时间（关闭思考后）

`node scripts/measure/first-bubble.mjs --base http://localhost:5182 --api http://localhost:8030 --user demo --password demo123 --character 陈千语 --prompt "你好，简单介绍一下你自己吧，分三句话说，每句话单独一行。" --runs 5`

| 轮次       | 网络：首个 SSE 数据块 | Enter → 首个气泡（t1） | Enter → 全文完成（t2） |
| ---------- | --------------------- | ---------------------- | ---------------------- |
| 1          | 531 ms                | 751 ms                 | 990 ms                 |
| 2          | 306 ms                | 499 ms                 | 710 ms                 |
| 3          | 688 ms                | 969 ms                 | 1203 ms                |
| 4          | 579 ms                | 772 ms                 | 1064 ms                |
| 5          | 477 ms                | 728 ms                 | 1045 ms                |
| **中位数** | **531 ms**            | **751 ms**             | **1045 ms**            |

- 与关闭思考前对比：首个气泡 5017 ms → 751 ms（−85%）；全文完成 5017 ms → 1045 ms。
- 流式按行 vs 原项目"等全文再显示"：首句提前 294 ms（回复只有三行、约 80 token，回复越长提前越多）。
- 首个数据块 531 ms 到首个气泡 751 ms 之间的 220 ms，是等第一行写完（第一个 `\n`）的时间。
- 脚本首版还想用 CDP 的 `loadingFinished` 记录响应结束时刻，但多数轮次收不到该事件（前端处理完 `[DONE]` 后释放了流），已删掉这一列，只保留"首个数据块"；修正后重跑一次：首个数据块 583 ms、首个气泡 718 ms、全文 1006 ms，与上表一致。

### 9.3 prompt_tokens 曲线与前缀缓存命中（60 条连续消息）

`python3 scripts/measure/prompt-tokens.py --api http://localhost:8030 --user demo --password demo123 --character 陈千语 --count 60`

| 第 n 条 | prompt_tokens | 缓存命中（prompt_cache_hit_tokens） |
| ------- | ------------- | ----------------------------------- |
| 1       | 4894          | 4736                                |
| 10      | 5227          | 4992                                |
| 20      | 5651          | 5504                                |
| 21      | 5683          | 4864                                |
| 40      | 5722          | 4864                                |
| 60      | 5704          | 4864                                |

- 第 1–20 条每条约 +38 token 线性增长；第 21 条起 40 条窗口填满，之后在 5700 上下波动（窗口滑动，旧消息被新消息替换）。按线性外推，不截断时第 60 条约 4894 + 59 × 38 ≈ 7100 token，截断后 5704（−20%），差距随会话继续拉大。
- 基线 4894 token 里绝大部分是两条 system（固定规则 + 世界观 + 角色提示词）；DeepSeek 按 128 token 块统计前缀缓存命中，第 1–20 条命中随会话增长（4736 → 5504）；窗口开始滑动后，每轮最前面的对话被丢弃、前缀改变，命中回落到 4864 并保持——system 部分一直命中缓存，只有对话部分需要按未命中价计费。
- 关闭思考前的同一曲线（首次测量）：4919 → 5227（#10）→ 5524（#20）→ 5597（#40）→ 5649（#60），形状一致；当时第 11 条遇到一次空原因的上游错误 `上游请求失败：`。`backend/app/ai.py` `_transport_message` 首版补的回落写成 `{exc or type(exc).__name__}`，异常对象恒为真值、回落永远走不到（整理讲稿时直接调用 `_transport_message(httpx.ReadError(""))` 复核发现）；缺陷修复轮改为 `str(exc) or type(exc).__name__`，并给 `test_upstream_transport_error_becomes_error_frame` 加了 `ReadError("") → 上游请求失败：ReadError` 的参数化用例。

## 10. 聊天区滚动、按需加载与长会话（2026-09-28，change chat-scroll-perf-hooks）

脚本：`scripts/measure/seed-messages.py`（用后端自己的模型写入确定性的长会话）与 `scripts/measure/chat-perf.mjs`（Playwright + CDP：会话矩阵与 `--lazy` 首屏两种模式），用法写在两个脚本的文件头注释里。改动前后用同一脚本、同一份种子、同一台机器：

- 改动前：`git archive HEAD frontend backend e2e` 导出到临时目录（HEAD 6f2055b），`node_modules` 软链到仓库，后端 8781、`vite preview` 5781。
- 改动后：当前工作区构建到临时目录，后端 8791、`vite preview` 5791。两边都是临时 SQLite、`AI_MOCK=1`、`DAILY_MESSAGE_LIMIT=1000`。
- 机器与浏览器：Apple M4 Pro（14 核）、macOS 15.5、Node 22.22.2、Playwright 1.62.1 自带 Chromium 151.0.7922.34（headless，rAF 按 120 Hz 即 8.33 ms 一帧）、视口 1920×1080（画布 zoom = 1）。测量期间同一台机器上还有其他构建与测试在跑（改动前一轮负载均值约 4，改动后一轮约 6）。每组 5 次的打开耗时逐次列在表里，其余指标只列中位数；度量脚本输出的原始 JSON 没有入库。
- "KB" 为 1024 B；入口 JS 的 kB 取 `vite build` 报告（1000 B）。

### 10.1 种子数据

| 角色 | 会话 id | 条数 | 我方 | 含表情 | 含换行 | 平均字符 |
| ---- | ------- | ---- | ---- | ------ | ------ | -------- |
| 诀   | 2       | 100  | 37   | 14     | 16     | 45.1     |
| 卡缪 | 3       | 500  | 190  | 95     | 58     | 47.1     |
| 弭弗 | 4       | 2000 | 758  | 384    | 205    | 44.5     |

改动后一轮在最终构建上测量，测量前清掉视觉核查时发过消息的会话并重新写入种子，三段会话的条数、表情与换行比例与上表一致。

### 10.2 长会话：打开 / DOM / 滚动

打开耗时 = 先打开一段空会话（梨诺）让消息区挂载，再点击目标子卡，直到最后一个气泡的文字等于会话最后一条消息、可见、气泡盖住文字、滚动容器贴底（≤ 2 px），再等一帧；4× 时先设降速再点击。"打开时消息 JSON"是 CDP 取到的响应体字节。元素数在加载全部历史后统计（分页版反复滚到顶部，直到 1 秒内没有新的消息请求）；DOM 消息行 = 聊天区内非加载气泡的气泡数。滚动 = 回到底部后鼠标停在聊天区中央，每步 `mouse.wheel(0, -300)` 从底滚到顶，全程 rAF 采样帧间隔；验收"聊天区 DOM 减少 90% 以上"用的是"聊天区元素"列（`getElementsByTagName('*')`）。

改动前：

| 条数 | CPU | 打开耗时中位数 | 打开耗时（各次）                       | 打开时消息 JSON | 历史请求 | 页面元素 | 聊天区元素 | DOM 消息行 | 滚动中最多气泡 | 帧 p50 / p95 / max   | >20 / >33 ms 帧 | LoAF 次数 / 最长 | JS 堆   |
| ---- | --- | -------------- | -------------------------------------- | --------------- | -------- | -------- | ---------- | ---------- | -------------- | -------------------- | --------------- | ---------------- | ------- |
| 100  | 1×  | 44.7 ms        | 56.7 / 44.7 / 46.2 / 43.1 / 43.3       | 21.5 KB         | 0        | 1438     | 888        | 100        | 100            | 8.3 / 8.8 / 16.6 ms  | 0 / 0           | 0 / 0 ms         | 4.6 MB  |
| 100  | 4×  | 102.8 ms       | 101.5 / 103.3 / 102.8 / 100.7 / 110.7  | 21.5 KB         | 0        | 1438     | 888        | 100        | 100            | 8.3 / 9.2 / 16.7 ms  | 0 / 0           | 0 / 0 ms         | 4.6 MB  |
| 500  | 1×  | 83.7 ms        | 115.4 / 80.6 / 83.7 / 90.2 / 82.5      | 109.0 KB        | 0        | 4995     | 4445       | 500        | 500            | 8.3 / 9.1 / 16.7 ms  | 0 / 0           | 0 / 0 ms         | 7 MB    |
| 500  | 4×  | 308 ms         | 323.6 / 303.8 / 341.3 / 308 / 303.7    | 109.0 KB        | 0        | 4995     | 4445       | 500        | 500            | 8.5 / 25 / 33.2 ms   | 38 / 1          | 0 / 0 ms         | 7 MB    |
| 2000 | 1×  | 257.7 ms       | 271.6 / 257.7 / 251.8 / 253.4 / 265.9  | 421.3 KB        | 0        | 18481    | 17931      | 2000       | 2000           | 8.4 / 17.1 / 33.2 ms | 58 / 1          | 0 / 0 ms         | 15.9 MB |
| 2000 | 4×  | 1063.2 ms      | 1001 / 1063.2 / 1050.7 / 1081 / 1135.5 | 421.3 KB        | 0        | 18481    | 17931      | 2000       | 2000           | 25.5 / 91.1 / 133 ms | 1006 / 562      | 295 / 87.8 ms    | 15.7 MB |

改动后：

| 条数 | CPU | 打开耗时中位数 | 打开耗时（各次）                 | 打开时消息 JSON | 历史请求 | 页面元素 | 聊天区元素 | DOM 消息行 | 滚动中最多气泡 | 帧 p50 / p95 / max    | >20 / >33 ms 帧 | LoAF 次数 / 最长 | JS 堆  |
| ---- | --- | -------------- | -------------------------------- | --------------- | -------- | -------- | ---------- | ---------- | -------------- | --------------------- | --------------- | ---------------- | ------ |
| 100  | 1×  | 38.8 ms        | 32 / 37 / 38.8 / 44.7 / 43       | 11.0 KB         | 1        | 691      | 137        | 12         | 23             | 8.3 / 8.4 / 25 ms     | 1 / 0           | 0 / 0 ms         | 4.6 MB |
| 100  | 4×  | 82.8 ms        | 84.9 / 80.3 / 82.8 / 87.2 / 80   | 11.0 KB         | 1        | 691      | 137        | 12         | 23             | 15.7 / 17.6 / 32.7 ms | 2 / 0           | 0 / 0 ms         | 4.6 MB |
| 500  | 1×  | 36.9 ms        | 35.1 / 38.2 / 32.5 / 36.9 / 39.3 | 11.7 KB         | 9        | 675      | 121        | 12         | 23             | 8.3 / 9.2 / 24.9 ms   | 1 / 0           | 0 / 0 ms         | 4.9 MB |
| 500  | 4×  | 91.2 ms        | 74.9 / 98.1 / 91.7 / 88.6 / 91.2 | 11.7 KB         | 9        | 675      | 121        | 12         | 23             | 16 / 24.4 / 42.4 ms   | 26 / 3          | 0 / 0 ms         | 4.9 MB |
| 2000 | 1×  | 38.6 ms        | 38.2 / 38.6 / 33.3 / 43.1 / 49.4 | 11.3 KB         | 39       | 673      | 119        | 12         | 24             | 8.3 / 9.2 / 41.5 ms   | 3 / 1           | 0 / 0 ms         | 5.7 MB |
| 2000 | 4×  | 80 ms          | 83.9 / 78.8 / 80 / 73.9 / 85     | 11.3 KB         | 39       | 673      | 119        | 12         | 24             | 16.2 / 24 / 50.4 ms   | 87 / 8          | 0 / 0 ms         | 5.7 MB |

结论：4× 降速下打开 2000 条会话 1063.2 → 80 ms（−92.5%），加载全部历史后聊天区元素 17,931 → 119（−99.3%），滚动帧 p95 91.1 → 24 ms（超过 33 ms 的帧 562 → 8，Long Animation Frame 295 → 0），打开时消息 JSON 421.3 → 11.3 KB，JS 堆 15.7 → 5.7 MB。代价：100 条会话在 4× 降速下滚动帧 p50 / p95 从 8.3 / 9.2 升到 15.7 / 17.6 ms（原来 100 行全部已挂载，滚动只是合成；虚拟化后每帧要挂载、测量进入可视区的行；同条件的前一轮为 16 / 25 ms，p95 在几轮之间波动较大）；加载全部 2000 条要向上加载 39 次，加上打开时的 1 次共 40 页（每页 50）。

### 10.3 首屏按需加载

新浏览器上下文、禁用缓存，每项 5 次中位数。"聊天页挂载" = 设置按钮与 29 张主卡都进入 DOM（`MutationObserver`，相对导航开始）。已登录打开 `/` 的做法是新上下文预写 token 后打开，等 networkidle 再点设置。慢速 4G 为 CDP `Network.emulateNetworkConditions`（latency 150 ms、下行 1.6 Mbps、上行 750 Kbps；CORS 预检不受限速，登录本身 bcrypt 约 180 ms，所以"点击登录 → 聊天页挂载"两种网络下相近）。

入口 JS：改动前唯一的 JS 133.41 kB（gzip，Vite 报告）；改动后入口 88.24 kB（−33.9%）、聊天页 chunk 51.68 kB、设置对话框 chunk 5.66 kB。这组数字来自度量用的构建（`VITE_API_BASE_URL` 指向本地 8791 端口，与改动前指向 8781 的构建字符串长度相同）；直接 `pnpm build`（用 `frontend/.env` 的接口地址）报告入口 88.23 kB，差别只来自内联的接口地址。入口 chunk 里不含 `chatStore`、`settingsStore`、SSE 解析、角色列表与设置对话框的代码（在产物里按标识符与文案检索确认）。

产物合计（`node scripts/measure/bundle-size.mjs --old <改动前 dist> --new <改动后 dist>`；改动前为 `git archive` 导出的 HEAD 6f2055b，两边都在 `frontend` 目录用 `frontend/.env` 直接 `vite build`；KB 为 1024 B）：

| 类别 | 改动前原始            | 改动前 gzip | 改动后原始            | 改动后 gzip | 原始差值                                 |
| ---- | --------------------- | ----------- | --------------------- | ----------- | ---------------------------------------- |
| JS   | 359.0 KB              | 130.3 KB    | 393.1 KB              | 142.2 KB    | +34.1 KB（+9.5%）                        |
| CSS  | 40.8 KB               | 8.4 KB      | 41.0 KB               | 8.5 KB      | +0.2 KB                                  |
| 字体 | 907.1 KB              | 907.4 KB    | 907.1 KB              | 907.4 KB    | 0                                        |
| 图片 | 349.7 KB              | 349.2 KB    | 349.7 KB              | 349.2 KB    | 0                                        |
| HTML | 0.8 KB                | 0.5 KB      | 0.9 KB                | 0.6 KB      | +0.2 KB（内联的 modulepreload 判断脚本） |
| 合计 | 1,657.4 KB（80 文件） | 1,395.8 KB  | 1,691.9 KB（82 文件） | 1,407.8 KB  | +34.4 KB（+2.1%）                        |

改动后 JS 分成入口 267.8 KB（gzip 86.2 KB）、聊天页 110.7 KB（gzip 50.5 KB）、设置对话框 14.6 KB（gzip 5.5 KB）。第 4 节的表是 2026-09-24 的数据，所以改动前的数字与第 4 节略有不同（JS 358.2 → 359.0 KB）。

无网络限速：

| 指标（5 次中位数）      | 改动前   | 拆包，未加 modulepreload | 拆包 + modulepreload（最终） |
| ----------------------- | -------- | ------------------------ | ---------------------------- |
| /login 表单出现         | 23.9 ms  | 21.6 ms                  | 21.7 ms                      |
| /login 首次内容绘制     | 40 ms    | 36 ms                    | 36 ms                        |
| /login JS 请求数        | 1        | 2                        | 2                            |
| 点击登录 → 聊天页挂载   | 194 ms   | 191.2 ms                 | 185.5 ms                     |
| / 导航开始 → 聊天页挂载 | 26.2 ms  | 27.4 ms                  | 23.9 ms                      |
| / /me 请求开始          | 18.9 ms  | 16.4 ms                  | 16.1 ms                      |
| / JS 请求数             | 1        | 3                        | 3                            |
| / JS 传输字节           | 133711 B | 146238 B                 | 146483 B                     |
| 点击设置 → 弹窗出现     | 4.5 ms   | 4.2 ms                   | 4.5 ms                       |

慢速 4G：

| 指标（5 次中位数）      | 改动前    | 拆包，未加 modulepreload | 拆包 + modulepreload（最终） |
| ----------------------- | --------- | ------------------------ | ---------------------------- |
| /login 表单出现         | 1060.6 ms | 835.5 ms                 | 841.4 ms                     |
| /login 首次内容绘制     | 1080 ms   | 852 ms                   | 860 ms                       |
| /login JS 请求数        | 1         | 2                        | 2                            |
| 点击登录 → 聊天页挂载   | 201.1 ms  | 199.1 ms                 | 202.1 ms                     |
| / 导航开始 → 聊天页挂载 | 1069.7 ms | 1345.6 ms                | 1104.9 ms                    |
| / /me 请求开始          | 1057.8 ms | 828.7 ms                 | 1090.2 ms                    |
| / JS 请求数             | 1         | 3                        | 3                            |
| / JS 传输字节           | 133711 B  | 146238 B                 | 146483 B                     |
| 点击设置 → 弹窗出现     | 4.9 ms    | 4.8 ms                   | 4.8 ms                       |

"最终"一列在最终构建上重测；"拆包，未加 modulepreload"一列是当时的中间构建，JS 字节比最终版少 245 B。最终版里已登录刷新时聊天页 chunk 与入口 JS 同时开始下载（无限速：入口 2 ms、聊天页 chunk 4 ms、`/me` 16.1 ms；慢速 4G：入口 160 ms、聊天页 chunk 163 ms）。"拆包，未加 modulepreload"一列说明为什么需要构建插件：聊天页 chunk 要等入口 JS 执行完才开始下载，慢速 4G 下已登录刷新慢 276 ms。已登录刷新下载的 JS 总量从 130.6 KB 增加到 143.0 KB（虚拟列表库与新代码，以及聊天页挂载后预取的设置对话框 chunk）。

只给聊天页套 `React.lazy` 并在入口里提前 `import()` 的中间版本，用页面内 `MutationObserver` 探针测得：已登录刷新聊天页 335 ms 才挂载、202 ms 起闪出加载动画，打开设置约 300 ms（React 19 的 Suspense 兜底节流，见 `docs/interview.md` 5.21）；改用 `lazyWithPreload` 后同一探针 3 次：聊天页 36–37 ms 挂载、无加载动画，设置直接打开。

### 10.4 复现

```bash
# 后端（backend/，临时库；CORS_ORIGINS 要包含 preview 的来源）
cd backend && DATABASE_URL=sqlite:////tmp/perf.db JWT_SECRET=<任意 32 字节以上> AI_MOCK=1 DAILY_MESSAGE_LIMIT=1000 \
  CORS_ORIGINS=http://127.0.0.1:5791 .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8791
# 种子（同样的环境变量）
backend/.venv/bin/python scripts/measure/seed-messages.py
# 前端
cd frontend && VITE_API_BASE_URL=http://127.0.0.1:8791 pnpm exec vite build --outDir /tmp/perf-dist && \
  pnpm exec vite preview --outDir /tmp/perf-dist --host 127.0.0.1 --port 5791 --strictPort
# 度量
node scripts/measure/chat-perf.mjs --base http://127.0.0.1:5791 --api http://127.0.0.1:8791 \
  --sizes 100:诀,500:卡缪,2000:弭弗 --cpu 1,4 --runs 5 --out chat-perf.json
node scripts/measure/chat-perf.mjs --lazy --base http://127.0.0.1:5791 --api http://127.0.0.1:8791 --runs 5 --network slow4g --out chat-perf-lazy.json
```

改动前的数据要先把 HEAD（6f2055b）导出到另一目录再按同样步骤构建与启动。

## 11. 打字机输出（2026-09-29，change chat-typewriter-effect）

### 11.1 逐字写出期间的重渲染

用例：`frontend/src/features/chat/rerender.measure.test.tsx` 的第二个用例，随 `pnpm test` 运行。场景与第 3 节相同（20 条历史 + 发送 1 条 + 30 帧 delta、10 行），区别是打字机开启、30 帧按 80 ms 间隔到达（与 mock 后端的节奏一致），用假计时器（含 `performance.now`）推进到逐字写完，再重拉。另外统计"已写完的行（`typing` 为 false、文字是完整的一行）在第一次以完整状态渲染之后又渲染了几次"，memo 版断言为 0。

| 指标                             | memo 版 | 对照版（去掉 memo） |
| -------------------------------- | ------- | ------------------- |
| Profiler commit 次数             | 115     | 115                 |
| ChatBubble 渲染：发送 → 重拉完成 | 102     | 771                 |
| 已写完的行再次渲染               | 0       | 413                 |
| 首帧到写完（假时间）             | 6400 ms | 6400 ms             |

解读：提交次数从整行场景的 26 升到 115，来自每次推进写出新字（一次可能写出多个字）、每次行间停顿的开始与结束；推进后可见内容没变就不写 store。memo 版的 102 次渲染几乎都是正在写的那个气泡（每次写出新字 1 次）以及每行出现、写完时的各 1 次；已写完的行在之后的逐字过程中一次也不渲染。对照版每次提交都重跑所有已渲染的气泡。jsdom 的 `ResizeObserver` 是桩，真实浏览器里正在写的气泡每写出新字还会因测量回调多渲染一次，两组相同。

复现：`cd frontend && pnpm exec vitest run src/features/chat/rerender.measure.test.tsx --disable-console-intercept`。

### 11.2 逐字写出期间的帧时长

脚本：`scripts/measure/chat-perf.mjs --typing`（用法写在文件头注释里）。在"洛茜"的第一段会话里（长会话矩阵不用这段会话），分别以打字机开启与关闭（经 `PATCH /api/settings` 切换）、1× 与 4× CPU 降速各发送 5 次"你好"，从按下 Enter 到停止按钮换回发送按钮（回复全部显示）全程用 `requestAnimationFrame` 采样帧间隔；每次结束后清空这段会话的消息与上下文，最后把开关恢复为测量前的值。

- 环境：后端 `AI_MOCK=1`、临时 SQLite、`DAILY_MESSAGE_LIMIT=1000`，端口 8795；前端当前工作区构建后 `vite preview`，端口 5795；演示账号 demo。Apple M4 Pro、macOS 15.5、Node 22.22.2、Playwright 1.62.1 自带 Chromium 151.0.7922.34（headless，rAF 120 Hz 即 8.33 ms 一帧），视口 1920×1080。测量时负载均值约 3–4.5。
- mock 回复固定三行共 33 字，每 80 ms 发 5 个字，约 560 ms 传完。

| 显示方式 | CPU | 回复耗时中位数（Enter → 全部显示） | 回复耗时（各次）                 | 帧数 | 帧 p50 / p95 / max  | >20 / >33 ms 帧 | LoAF 次数 / 最长 |
| -------- | --- | ---------------------------------- | -------------------------------- | ---- | ------------------- | --------------- | ---------------- |
| 打字机   | 1×  | 2335 ms                            | 2340 / 2335 / 2335 / 2333 / 2332 | 280  | 8.3 / 9 / 9.4 ms    | 0 / 0           | 0 / 0 ms         |
| 打字机   | 4×  | 2436 ms                            | 2436 / 2506 / 2434 / 2432 / 2440 | 285  | 8.3 / 9.2 / 24.4 ms | 1 / 0           | 0 / 0 ms         |
| 整行     | 1×  | 813 ms                             | 806 / 812 / 813 / 813 / 823      | 96   | 8.3 / 9.1 / 9.3 ms  | 0 / 0           | 0 / 0 ms         |
| 整行     | 4×  | 894 ms                             | 887 / 894 / 897 / 888 / 894      | 102  | 8.3 / 9.3 / 17.2 ms | 0 / 0           | 0 / 0 ms         |

各次原始值：打字机 4× 的帧 p95 为 9.2 / 9.3 / 9.2 / 9.2 / 9.3 ms，最长帧 17.6 / 28.4 / 25.1 / 17.6 / 24.4 ms；整行 4× 的最长帧 16.6 / 17.2 / 25.1 / 16.7 / 34.1 ms（第 5 次有 1 帧超过 33 ms）。表中其余各列为 5 次中位数，度量脚本输出的原始 JSON 没有入库。

结论：4× CPU 降速下逐字写出全程帧 p95 9.2 ms、中位最长帧 24.4 ms，没有超过 33 ms 的帧，也没有 Long Animation Frame；每次推进只有正在写的气泡与虚拟列表的测量需要工作。代价是回复全部显示的时间变长：三行回复打字机下约 2.4 秒（打字约 0.8 秒、两次行间停顿 1 秒，其余与网络传输重叠），整行约 0.9 秒。

### 11.3 产物体积

直接 `pnpm build`（`frontend/.env` 的接口地址）的 Vite 报告：改动前为 `git archive` 导出的 HEAD 用同样方式构建。入口 274.27 kB（gzip 88.23 kB）不变；聊天页 chunk 113.34 → 116.48 kB（gzip 51.68 → 52.90 kB，+1.22 kB），来自 `typewriter.ts` 与 chatStore 的显示驱动；设置对话框 chunk 14.93 → 15.25 kB（gzip 5.66 → 5.76 kB），来自"AI 配置"页的打字机开关。两者都不在入口里，登录页首屏不受影响。

### 11.4 复现

```bash
# 后端（backend/，临时库，AI_MOCK=1）
cd backend && DATABASE_URL=sqlite:////tmp/typing.db JWT_SECRET=<任意 32 字节以上> AI_MOCK=1 DAILY_MESSAGE_LIMIT=1000 \
  CORS_ORIGINS=http://127.0.0.1:5795 .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8795
# 前端
cd frontend && VITE_API_BASE_URL=http://127.0.0.1:8795 pnpm exec vite build --outDir /tmp/typing-dist && \
  pnpm exec vite preview --outDir /tmp/typing-dist --host 127.0.0.1 --port 5795 --strictPort
# 度量
node scripts/measure/chat-perf.mjs --typing --base http://127.0.0.1:5795 --api http://127.0.0.1:8795 \
  --cpu 1,4 --runs 5 --out chat-perf-typing.json
```
