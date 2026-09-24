# 目标

用 React + TypeScript 重写 `endfield-baker-chat`（原为 Vue 3 + Pinia 的"终末地 BAKER 会话消息"角色聊天应用），新增 Python FastAPI 后端与登录功能，AI 能力改用 DeepSeek 官方 API，并吸收 `yuan-Chat` 中适合本项目的技术点，形成一个可用于初级前端面试展示的完整工程（含 Git 管理、测试、Lint、CI）。

# 范围

## Source coverage

覆盖边界：用户请求本身 + `endfield-baker-chat` 现有全部用户可见功能（作为重构基线）+ `yuan-Chat` 中可迁移的技术点（仅作技术参考）。原项目功能清单已由调查逐项整理：

| 来源条目 | 读取状态 | 需要保留的内容 | Spec 位置 | 验收 ID | 覆盖状态 | 理由 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 页头 | complete | 装饰图 + 标题"//BAKER/会话消息" | specs/baker-chat/spec.md §4 | A16 | covered | 保留 |
| S2 角色主卡列表（29 角色、折叠、选中、hover） | complete | 全部 | specs/baker-chat/spec.md §5 | A17 | covered | 保留 |
| S3 子卡/会话（预览、性别占位文案、单击选中） | complete | 除移动端双击外全部 | specs/baker-chat/spec.md §5 | A17、A18 | covered | 保留 |
| S4 工具栏（新建会话、对话管理、分享、设置、E 键隐藏） | complete | 新建、管理、设置、E 键 | specs/baker-chat/spec.md §6 | A19、A20 | covered | "分享"=PNG 导出，删除 |
| S5 聊天区（空态、聊天条样式循环、入场动画、自动滚底、头像显隐规则、我方头像性别切换） | complete | 全部 | specs/baker-chat/spec.md §7 | A21、A22、A23 | covered | D5 |
| S6 气泡/头像/加载气泡/图片消息 | complete | 气泡、头像、加载气泡的视觉 | specs/baker-chat/spec.md §7 | A21 | covered | 图片消息按 D6 删除 |
| S7 输入区（Enter 发送、组合键换行、纯文本粘贴、回复中禁用、停止按钮、图片上传） | complete | 除移动 textarea、图片上传外全部 | specs/baker-chat/spec.md §8 | A24 | covered | D6 |
| S8 表情（37 个、token 存储、光标插入、外部点击关闭） | complete | 全部 | specs/baker-chat/spec.md §8 | A25 | covered | 保留 |
| S9 AI 回复行为（按行分段逐条出现、停止、错误提示、切会话仍写回原会话） | complete | 全部（分段改为流式按行） | specs/baker-chat/spec.md §9 | A26–A29 | covered | D4 |
| S10 对话管理（删除对话、清空消息、清空上下文） | complete | 全部 | specs/baker-chat/spec.md §10 | A33、A34 | covered | 保留 |
| S11 设置-API 配置 | complete | 温度、最大 Token、连接测试 | specs/baker-chat/spec.md §11 | A36 | covered | D3，shared/custom/backend 三模式合并为后端代理 |
| S12 设置-世界观/角色提示词/免责/关于 | complete | 全部 | specs/baker-chat/spec.md §11 | A35 | covered | 保留 |
| S13 数据管理（统计、删除全部对话、清空全部消息/上下文） | complete | 除 ZIP 外全部 | specs/baker-chat/spec.md §11 | A37 | covered | ZIP 删除 |
| S14 设计画布 1920×1080 zoom 缩放 | complete | 等比缩放 | specs/baker-chat/spec.md §4 | A16 | covered | D5 |
| S15 持久化（IndexedDB/localStorage） | complete | 数据不丢 | specs/baker-chat/spec.md §3 | A15 | covered | D2，改为后端存储 |
| S16 PNG 截图导出 | complete | — | — | — | non-goal | 用户明确不做 |
| S17 ZIP 导入导出 | complete | — | — | — | non-goal | 用户明确不做 |
| S18 自定义背景图 | complete | — | — | — | non-goal | 用户明确不做 |
| S19 移动端适配 | complete | — | — | — | non-goal | 用户明确不做 |
| S20 语音输入 | complete | — | — | — | non-goal | 原项目本无此功能；yuan-Chat 的语音 Hook 不迁移 |
| S21 调试模式 `#debug` | complete | — | — | — | non-goal | 开发辅助，非面试展示点 |
| S22 新增：登录 | — | 用户账号与鉴权 | specs/baker-chat/spec.md §2 | A9–A14 | covered | D2、D7 |
| S23 新增：FastAPI 后端 + DeepSeek | — | 后端代理 AI、隐藏 Key | specs/baker-chat/spec.md §9 | A26–A32 | covered | D3、D10、D11 |
| S24 新增：Git、测试、Lint、CI | — | 工程化与部署 | specs/baker-chat/spec.md §1、§12 | A1–A8 | covered | D1、D9、D12–D15、D17、D18 |

# 非目标

- 语音输入、自定义背景图、ZIP 导入导出、PNG 截图导出、移动端适配、`#debug` 调试面板。
- 多角色群聊、AI 主动发言（原项目也没有）。

# 验收示例

以下是工程化与交付层面的验收项。产品行为的验收项见 `specs/baker-chat/spec.md` 中的各个 Scenario。

- 在仓库根目录执行 `git status` 可以看到这是一个 Git 仓库，`git remote -v` 的 `origin` 指向用户提供的 GitHub 仓库且 `main` 已推送；`git ls-files` 中不包含 `endfield-baker-chat/`、`yuan-Chat/`、`node_modules`、`.env` 和数据库文件；提交历史符合 Conventional Commits，不合规的提交信息会被 commitlint 拒绝。
- 在 `frontend/` 下 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过；在 `backend/` 下 `ruff check`、`ruff format --check`、`pytest` 全部通过。
- `pnpm e2e`（Playwright，后端设置 `AI_MOCK=1`）通过"注册 → 登录 → 选角色 → 发消息 → 看到逐行出现的回复气泡"这条冒烟用例。
- `.github/workflows/ci.yml` 包含 frontend、backend、e2e 三个任务，并在 push 和 PR 时触发；CI 执行的命令与本地相同；推送到 GitHub 后最近一次 Actions 运行为通过。
- 在仓库根目录执行 `docker compose up --build` 后，可以在 http://localhost:5173 用演示账号登录，并且完成一次对话（真实 Key 或 `AI_MOCK=1` 均可）。
- 按 `docs/deploy.md` 完成部署后，Vercel 线上地址能够用演示账号登录，与任一角色完成一次真实的 DeepSeek 对话；刷新后消息仍在（数据存储在 Neon Postgres）。
- README 包含架构图、技术栈、本地启动、测试命令和线上地址；`docs/interview.md` 包含技术选型表（每项有候选方案与放弃理由）、至少 8 个技术亮点（每个按 背景与问题 → 调研与选型 → 如何发现问题 → 如何解决 → 结果与代价 五段写，附代码路径）、至少 3 项优化记录（每项有测量方法、优化前后实测数据和复现步骤）、至少 5 条问题排查记录（现象 → 定位 → 根因 → 修复 → 验证）；每个技术亮点对应的代码处有 💡 注释指回文档锚点。
- 注释规范落地：随机抽查 `frontend/src` 和 `backend/app` 下任意 5 个源文件，每个文件顶部都有中文文件级文档注释，文件内每个函数、组件、Hook、路由处理器和模型类都有中文文档注释，关键逻辑处有单行中文注释；emoji 只出现 ✅ / ⚠️ / 💡 三种且每个文件不超过 5 处；ESLint 的 jsdoc 规则和 ruff 的 D 规则在本地与 CI 中开启并通过。

# 约束与不变量

- 原项目视觉（配色、素材、字体、尺寸常量）保持一致，素材直接复用原项目 `src/assets`。
- DeepSeek API Key 只保存在后端环境变量中，前端代码与网络请求中不出现。
- 仅桌面浏览器。
- 不迁移旧版浏览器 IndexedDB 中的数据。
- 代码风格遵循互联网大厂主流约定（细则见 D20）：前端一律函数组件 + Hooks，不写 class component；TypeScript strict，不用 `any`。
- 注释规范（细则见 D24）：所有源文件和函数都有中文文档注释，关键代码有单行注释，emoji 只用 ✅ / ⚠️ / 💡 且克制使用。
- "五板斧"约束（细则见 D21）：严禁超前设计、严禁过度工程、严禁防御未出现的错误、严禁向后兼容、严禁用胶水代码掩盖需要修剪的实现和旧路径。

# 决策

- 工作区：在当前目录进行（`current`），原项目 `endfield-baker-chat/`、`yuan-Chat/` 只读作为参考。
- D1（Q1=A）：在 `comet-baker-1/` 根目录 `git init`，新代码位于 `frontend/` 与 `backend/`；两个旧项目加入 `.gitignore`，只在本地保留作参考。
- D2（Q2=A）：会话、消息、上下文历史、世界观、角色提示词覆盖、温度/最大 Token、我方头像性别、聊天条样式都按用户存到后端 SQLite，用户之间数据隔离。
- D3（Q3=A）：只走后端代理 DeepSeek（OpenAI 兼容接口）；`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 从后端 `.env` 读取；前端不提供自定义 API。设置页保留温度、最大 Token 和连接测试。
- D4（Q4=A）：后端透传 SSE，前端流式解析；每收完一整行（`\n`）就立即显示为一个气泡；停止生成时保留已显示的行，未完成的半行丢弃。
- D5（Q5=A）：保留 1920×1080 设计画布的等比缩放和 SVG 气泡外观；消息列表改用 flex 流式布局，头像显隐与间距规则保持原样。
- D6（Q6=A）：去掉图片上传和图片消息。
- D7（Q7=A）：提供注册、登录、退出，并预置一个演示账号；未登录时访问聊天页跳转到登录页；接口返回 401 时清除登录态并跳回登录页。
- D8（用户追加，已被 D22 细化）：引入 Tailwind CSS 重写样式，原配色作为 Tailwind 主题 token。
- D9（Agent 实现选择）：React 19 + TS + Vite、Zustand、React Router、FastAPI + SQLAlchemy + SQLite、JWT、Vitest + RTL、pytest、ESLint + Prettier、ruff、GitHub Actions。
- D10（Q8=A）：发给 AI 的上下文只带最近 40 条（system 提示词固定保留）；可见消息不受影响。
- D11（Q9=A）：每个用户每天最多发 100 条消息，限额由 `.env` 的 `DAILY_MESSAGE_LIMIT` 配置；超出后返回 429，前端提示"今日额度已用完"；演示账号同样受限。
- D12（Q10=B）：提供 `docker-compose up` 一键本地启动；同时做线上部署，前端部署到 Vercel，后端部署到 Render 或 Fly.io；前端通过 `VITE_API_BASE_URL` 指向后端，后端 CORS 白名单由环境变量配置。
- D13（Q11=A）：用 Playwright 写 E2E 冒烟测试（注册/登录 → 选角色 → 发消息 → 看到回复气泡），后端 AI 调用使用 mock；在 CI 中运行。
- D14（Q12=A）：husky + lint-staged（提交前检查）+ commitlint（Conventional Commits）。
- D15（Q13=A，用户追加细化）：写 README（架构图、启动、技术栈）和 `docs/interview.md`。后者是面试讲稿，"注释中简要说，文档里细致讲"，固定结构如下：
  - 项目概览：一句话定位、架构图、数据流。
  - 技术选型表：每项列出候选方案、取舍理由、最终结论（如 Zustand vs Context+useReducer vs RTK；手写 SSE 解析 vs EventSource vs 第三方库；Tailwind v4 全量 vs SCSS 混用；flex 布局 vs 逐条计算坐标；JWT 存 localStorage vs httpOnly cookie；SQLite/Postgres 切换）。
  - 技术亮点：每个技术点按五段写——背景与问题 → 技术调研与选型 → 如何发现问题 → 如何解决 → 结果与代价，并附代码路径。
  - 优化记录：每项写明测量方法、优化前数据、优化后数据、复现步骤；数据必须是实际测出来的，不能估算。候选：首个 AI 气泡出现时间（原项目等全文 vs 流式按行）、流式过程中消息行的重渲染次数（React Profiler，memo 前后）、前端产物体积（角色提示词移到后端前后）、单次请求 prompt tokens（上下文截断前后，用 DeepSeek 返回的 usage）。
  - 问题排查记录：开发中真实遇到的问题，每条按 现象 → 定位方法 → 根因 → 修复 → 验证 记录（例如 yuan-Chat 的中断竞态与单例解析器、Tailwind preflight 对内联表情图片的影响、流式回调中的过期闭包）。
  - 可改进之处与面试问答速查。
  - 文档在 Build 过程中随做随记，不在最后补写。
- D16（Agent 实现选择）：停止或断开时，后端持久化已完成的行；每次请求使用独立的 AbortController/解析器；上游错误以 SSE 错误帧返回，前端在气泡中显示中文错误；ErrorBoundary、toast、`aria-label`；bcrypt 哈希密码 + JWT（7 天，存 localStorage）。
- D17（Q14=A）：后端通过 `DATABASE_URL` 切换数据库：本地和 CI 用 SQLite，线上用 Neon 免费 Postgres。
- D18（Q15=A）：由 Agent 准备部署配置、环境变量清单和 `docs/deploy.md` 分步文档；用户按文档完成账号注册和控制台操作，Agent 协助排错。线上地址冒烟通过后才算验收通过。
- D19（Supervisor 评估）：不拆分子任务。前端各功能都依赖后端接口，拆开后接口联调成本高于并行收益，所以由单个 change 顺序推进。
- D20（用户追加，代码风格）：
  - 前端：只写函数组件 + Hooks；组件文件 `PascalCase.tsx`、Hook 文件 `useXxx.ts`、其他 `camelCase.ts`；一个文件一个组件，统一具名导出；按功能分目录 `src/features/{auth,characters,chat,settings}`，共享 UI 放 `src/components`，网络与 SSE 放 `src/lib`；`@/` 路径别名；props 用 `interface XxxProps`；事件回调 `onXxx` / `handleXxx`；ESLint 采用 typescript-eslint、react-hooks、react-refresh 的 recommended 规则集 + Prettier（singleQuote、semi、printWidth 100、tailwind 插件排序 class）。
  - 后端：单个 `app/` 包，按 `main.py`、`config.py`、`db.py`、`models.py`、`schemas.py`、`deps.py`、`ai.py`、`characters.py`、`routers/*.py` 组织；全量类型注解；ruff 启用 E、F、I、UP、B、N；不设 service / repository 层。
- D21（用户追加，"五板斧"）：
  - 没有第二个真实调用点之前不抽象；不设 `utils` 杂物箱；不为假设需求留配置（例如不做多 AI 供应商抽象，只有一个 DeepSeek 客户端）。
  - 只在真实边界（网络、鉴权、上游 AI、用户输入）处理错误；纯逻辑不包 try/catch；不为不可能出现的状态写分支。
  - 不做向后兼容：不迁移旧数据、不保留旧字段名或旧路径；旧项目里被注释掉的功能（如"显示角色名称"开关）不移植。
  - 需要重构就直接重构，不用适配层掩盖；死代码删除而不是注释。
  - 由此调整 D16：不做全局 ErrorBoundary（它必须是 class component，且属于防御性代码）；只保留针对真实失败的 toast 提示。
- D22（Q16=A，CSS 方案）：只用 Tailwind v4 + 一个 `src/styles/index.css`，不引入 SCSS、CSS Modules、cva、tailwind-merge。
  - `index.css` 只放：`@import "tailwindcss"`、`@theme`（颜色、字号、圆角、字体、动画时长/keyframes 令牌，与原 `_variables.scss` 和 `colors.ts` 一一对应，作为唯一来源）、`@font-face`、`@utility scroll-mask`（参数用 CSS 变量传入）。
  - 原 mixin 的对应：`dialog-shell` → `DialogShell` 组件；`hover-overlay` → 显式 `<span>` + `group-hover`；`origin-container` → 工具类；状态样式用 `data-*` 属性 + `data-*:` 变体。
  - 设计稿小数坐标和字号用任意值原样写（如 `left-[546.02px]`、`text-[20.88px]`），出现 3 次以上的做成令牌；zoom、气泡 SVG 宽高、clip-path 进度、表情宽度等动态数值用内联 style / SVG 属性。
  - 逐一核对 Tailwind preflight 与原重置的差异（如 `img` 默认 `display:block`，表情图片要显式 `inline`）。
  - 用 `clsx` 组合条件 class，`prettier-plugin-tailwindcss` 排序 class。
- D23（Q17=A，GitHub）：远程仓库为 `git@github.com:Youri2000/baker-chat.git`（用户已提供，SSH 方式）；Agent 在 Build 阶段配置 `origin`、推送 `main`，并确认 GitHub Actions 运行通过。工作区为 `current`，推送在 Build 内完成，不依赖归档收尾。提交作者使用本机已有的 git 全局配置。
- D24（用户追加，注释规范）：
  - 每个源文件（.ts/.tsx/.py/.css/.yml/配置文件）顶部有中文文件级文档注释，说明职责和与谁协作；JSON 文件除外。
  - 每个函数、React 组件、Hook、Zustand store、FastAPI 路由处理器、Pydantic/SQLAlchemy 模型和测试用例都有中文文档注释：TS 用 JSDoc `/** */`（说明用途、非显而易见的参数与返回值），Python 用 Google 风格 docstring。
  - 关键代码加单行注释：解释接下来一段逻辑或某个步骤时独占一行放在其上；标注单个表达式、字段或常量值时放在同一行末尾，且不超过约 40 个字。
  - emoji 只用三种：✅ 标记核心功能代码，⚠️ 标记易错或关键代码（竞态、闭包、编码、边界），💡 标记设计取舍说明（面试讲解点）；每个文件不超过 5 处，普通注释不加 emoji。
  - 💡 注释只用一两句话点明取舍或优化结论，并指向 `docs/interview.md` 的对应锚点（如 `// 💡 手写 SSE 解析而非 EventSource：需要 POST + 自定义头，详见 docs/interview.md#sse`）；细节全部写在文档里，注释不展开。
  - 注释解释"为什么"和"做什么"，不复述代码；标识符保持英文。
  - 用 ESLint `eslint-plugin-jsdoc`（require-jsdoc 覆盖函数、箭头函数组件、Hook）和 ruff `D` 规则（Google 约定）在本地与 CI 中强制文档注释存在。

# 待解决问题

无。Q1–Q17 均已确认，结论见"决策"一节。

# 验证预期

前端 Vitest + React Testing Library、后端 pytest、ESLint/Prettier 与 ruff、`tsc` 类型检查、生产构建均在本地与 GitHub Actions 中通过；手动启动前后端完成登录 → 选角色 → 发消息 → 流式回复的端到端冒烟。
