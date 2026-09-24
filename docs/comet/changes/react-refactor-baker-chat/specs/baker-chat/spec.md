# Baker Chat 规格

"终末地 BAKER 会话消息"角色聊天应用：用 React + TypeScript 前端、FastAPI 后端重写；需要登录；AI 通过后端代理调用 DeepSeek。只支持桌面浏览器。

## 1. 架构与目录

- 仓库根目录为 `comet-baker-1/`，已执行 `git init`。
  - `frontend/`：React 19、TypeScript（strict）、Vite、Zustand、React Router、Tailwind CSS v4。
  - `backend/`：FastAPI、SQLAlchemy、Pydantic Settings；数据库用 SQLite 或 Postgres，由 `DATABASE_URL` 决定。
  - `e2e/`：Playwright。
  - `.github/workflows/`：CI 配置。
- `endfield-baker-chat/`、`yuan-Chat/` 写入 `.gitignore`，只作本地参考，不进入仓库。
- 视觉素材（头像、表情、装饰图、字体）从原项目复制到 `frontend/src/assets/`；29 个角色提示词、世界观默认值、固定系统提示词等常量一并迁移。
- 样式方案：只用 Tailwind v4 加一个 `src/styles/index.css`，不引入 SCSS、CSS Modules、cva、tailwind-merge。
  - `index.css` 只包含 `@import "tailwindcss"`、`@theme` 令牌（颜色、字号、圆角、字体、动画，与原 `_variables.scss` / `colors.ts` 一一对应，是唯一来源）、`@font-face`、`@utility scroll-mask`。
  - 设计稿小数坐标和字号用任意值原样书写（如 `left-[546.02px]`、`text-[20.88px]`），出现 3 次以上的值做成令牌；zoom、气泡 SVG 尺寸、clip-path 进度、表情宽度等动态数值用内联 style 或 SVG 属性。
  - 弹窗外壳用 `DialogShell` 组件复用；hover 白层用显式元素 + `group-hover`；选中/折叠等状态用 `data-*` 属性和 `data-*:` 变体。
  - 逐项核对 Tailwind preflight 与原重置的差异，例如表情 `<img>` 必须显式 `inline`。
- 代码风格：
  - 前端只写函数组件 + Hooks；组件文件 `PascalCase.tsx`、Hook `useXxx.ts`；一个文件一个组件，具名导出；按功能分目录 `src/features/{auth,characters,chat,settings}`，共享 UI 在 `src/components`，网络和 SSE 在 `src/lib`，`@/` 别名；TypeScript strict，不用 `any`。
  - 后端为单个 `app/` 包：`main.py`、`config.py`、`db.py`、`models.py`、`schemas.py`、`deps.py`、`ai.py`、`characters.py`、`routers/*.py`；全量类型注解；不设 service / repository 层。
  - "五板斧"：没有第二个真实调用点不抽象；只在网络、鉴权、上游 AI、用户输入这些真实边界处理错误；不做向后兼容和数据迁移；死代码删除而不是注释；不做全局 ErrorBoundary。
- 注释规范（中文）：
  - 每个源文件顶部有文件级文档注释，说明职责和协作关系（JSON 除外）。
  - 每个函数、组件、Hook、store、路由处理器、模型和测试用例都有文档注释：TS 用 JSDoc，Python 用 Google 风格 docstring。
  - 关键逻辑加单行注释：解释一段逻辑时独占一行放在其上；标注单个表达式或常量时放在行尾，不超过约 40 个字。
  - emoji 只用 ✅（核心功能）、⚠️（易错或关键）、💡（设计取舍，面试讲解点），每个文件不超过 5 处。
  - 用 `eslint-plugin-jsdoc` 的 require-jsdoc 和 ruff 的 `D` 规则强制文档注释存在。
- 以下功能不实现：语音输入、自定义背景、ZIP 导入导出、PNG 截图导出、移动端、`#debug` 面板、图片消息、在浏览器里填写自定义 API。

## 2. 账号与鉴权

- 用户名：3–20 位，只能包含字母、数字、下划线，不能重复。
- 密码：6–64 位，后端用 bcrypt 哈希保存，任何接口都不返回密码或哈希。
- 登录或注册成功后，后端返回 JWT（有效期 7 天）。前端把 token 存在 localStorage，之后每个请求都带 `Authorization: Bearer`。
- 后端首次启动时，如果演示账号不存在就自动创建。用户名和密码来自 `DEMO_USERNAME` / `DEMO_PASSWORD`，默认 `demo` / `demo123`。登录页展示演示账号信息，并提供"一键填入"。
- 路由：
  - `/login`、`/register` 是公开页面。
  - `/` 是聊天主页，必须登录；未登录访问会跳到 `/login`。
  - 已登录用户访问 `/login` 会跳到 `/`。
- 退出登录会清除 token 并回到 `/login`。
- 任何接口返回 401 时，前端清除 token、跳到 `/login`，并提示"登录已过期，请重新登录"。

#### Scenario: 注册新账号
- WHEN 用户在 `/register` 输入合法且未被占用的用户名、密码和一致的确认密码并提交
- THEN 账号创建成功，页面自动进入已登录状态并跳到 `/`，看到全部 29 个角色主卡

#### Scenario: 注册表单校验
- WHEN 用户名不合规、已被占用，或两次密码不一致时提交
- THEN 表单不跳转，在对应输入框下方显示中文错误原因；用户名被占用的错误来自后端返回的 409

#### Scenario: 登录与错误密码
- WHEN 用户在 `/login` 输入正确的账号密码
- THEN 跳转到 `/`
- WHEN 密码错误
- THEN 停留在登录页，显示"用户名或密码错误"

#### Scenario: 路由守卫与退出
- WHEN 未登录直接访问 `/`
- THEN 跳到 `/login`
- WHEN 已登录用户在设置中点击"退出登录"
- THEN token 被清除并回到 `/login`；此时按浏览器后退也进不了 `/`

#### Scenario: token 失效自动登出
- WHEN localStorage 里的 token 已过期或被篡改，用户在主页上发起任何请求
- THEN 前端跳到 `/login`，并提示"登录已过期，请重新登录"

#### Scenario: 用户数据隔离
- WHEN 用户 A 创建会话并发送消息后，用户 B 登录
- THEN 用户 B 看不到 A 的任何会话、消息、提示词覆盖或设置；用 B 的 token 访问 A 的会话 ID 时返回 404

## 3. 数据模型与持久化（后端）

- `User`：id、username、password_hash、created_at。
- `UserSettings`（与用户一对一）：
  - temperature（0–2，默认 0.8）
  - max_tokens（1–8192，默认 2048）
  - world_setting（空值表示使用默认世界观）
  - my_gender（`male` / `female`，默认 `male`）
  - strip_variant（0–2，默认 0）
- `PromptOverride`：user_id、character_name、prompt。
- `Conversation`：id、user_id、character_name、created_at、updated_at。
- `Message`：id、conversation_id、side（`mine` / `other`）、text（包含 `[sns_emoji_NNN]` token）、status（`completed` / `aborted` / `failed`）、created_at。
- `ContextEntry`：conversation_id、role（`user` / `assistant`）、content、created_at。这是 AI 的记忆，和可见消息分开存储。
- 每个用户第一次登录时，后端为 29 个内置角色各建一个空会话；每个角色至少保留一个会话。
- 表结构在应用启动时自动创建。本地和 CI 使用 SQLite 文件；线上通过 `DATABASE_URL` 连接 Postgres（Neon）。
- 不迁移旧版浏览器 IndexedDB 中的数据。

#### Scenario: 刷新后数据仍在
- WHEN 用户发送消息、收到回复、修改世界观、切换我方头像性别、切换聊天条样式，然后刷新页面或换一个浏览器登录同一账号
- THEN 以上内容全部恢复

## 4. 主界面布局与画布

- 固定 1920×1080 设计画布。窗口尺寸变化时按 `min(innerWidth/1920, innerHeight/1080)` 用 CSS `zoom` 等比缩放，resize 事件用 rAF 节流。
- 默认背景为 `bg_app.webp`，上面叠 `rgba(0,0,0,0.85)` 遮罩并做模糊。
- 页头显示装饰图和标题 "//BAKER/会话消息"。
- 设计坐标沿用原项目 `design.ts` / `chatGeometry.ts` 的常量：
  - 角色列表：(0, 122.57)，526×897.27；
  - 聊天条：(546.02, 114.44)，1323×67.67；
  - 聊天框：(546.02, 188.84)，1323×831。

#### Scenario: 画布等比缩放
- WHEN 浏览器窗口改为 1280×720
- THEN 整个界面按 2/3 等比缩小，不出现滚动条，各元素的相对位置和原设计一致

## 5. 角色主卡与会话子卡

- 左侧列表显示 29 个内置角色的主卡：头像（圆形裁剪）、角色名、聊天角标动画、折叠箭头。默认全部折叠。
- 点击主卡会切换它的折叠状态，并把它设为"选中主卡"（常显白色遮罩）。hover 显示白层，hover 状态在主卡和子卡之间平滑传递。
- 每张子卡对应一段会话：
  - 预览显示最后一条消息的文本，表情渲染成图片，超长时省略。
  - 没有消息时按角色性别显示"和他聊聊 / 和她聊聊 / 和TA聊聊"。
- 单击子卡会选中这段会话，同时选中它所属的主卡。选中效果：黄色层横向展开、文字变深、出现箭头装饰。
- 列表区域可纵向滚动，顶部、底部、右侧带渐隐 mask。

#### Scenario: 展开主卡并选中会话
- WHEN 用户点击"陈千语"主卡，再单击它下面的子卡
- THEN 主卡展开并变为选中，子卡出现黄色选中效果，右侧聊天区顶部显示"陈千语"，并加载这段会话的历史消息

#### Scenario: 子卡预览文案
- WHEN 某段会话没有消息
- THEN 子卡按角色性别显示"和他聊聊 / 和她聊聊 / 和TA聊聊"
- WHEN 会话最后一条消息含表情 token
- THEN 预览里的表情显示为图片而不是 token 文本

## 6. 工具栏

右上角固定工具栏，图标 25px、透明度 0.5，hover 变灰。从右到左依次为：

1. 新建会话：
   - 已选中主卡时，在该角色下新增一个空会话，自动展开主卡并选中新会话；
   - 没有选中主卡时，弹出"请先选中角色卡片"对话框，只有"确定"按钮。
2. 对话管理：见第 10 节。
3. 设置：见第 11 节。

按 E 键切换工具栏的显示和隐藏。焦点在输入框或 contenteditable 内，或同时按住 Ctrl/Meta/Alt 时不触发。

#### Scenario: 新建会话
- WHEN 用户选中"陈千语"主卡后点击"新建会话"
- THEN 该主卡下多出一张空子卡并被选中；刷新后这张子卡仍然存在
- WHEN 没有选中任何主卡时点击"新建会话"
- THEN 弹出"请先选中角色卡片"提示框

#### Scenario: E 键切换工具栏
- WHEN 焦点不在输入框时按 E
- THEN 工具栏隐藏，再按一次恢复显示
- WHEN 焦点在消息输入框内按 E
- THEN 输入框输入字母 e，工具栏不变化

## 7. 聊天区

- 没有选中会话时，显示占位图、点阵 SVG 和"- 请选择会话 -"。
- 选中会话后：
  - 顶部聊天条显示角色名。点击聊天条会在 v1/v2/v3 三种样式之间循环，所选样式按用户保存。
  - 聊天框保留原设计：1.5px 框线、顶部缺口、SVG 凹口、品红/黄/青三色发光条、右上角装饰、底部装饰。
- 切换会话时，消息区播放 0.3s 入场动画。消息数量或加载状态变化时自动滚到底部。
- 消息列表用 flex 纵向流式布局，不做逐条绝对定位：
  - 对方（AI）靠左，我方靠右。
  - 左右方向变化，或同一侧换了说话人时，显示头像；同一说话人连续发言时不重复显示头像。
  - 消息间距：同一说话人 14，跨方向 33，同侧换说话人 60。
- 气泡用 SVG 绘制：圆角 13.65 的矩形加尾巴。
  - 对方气泡：底色 #464444、白字；我方气泡：底色 #f0eeee、黑字。
  - 字体 HarmonyOS Sans SC Medium，字号 20.88，行高 1.5，最大宽度 660，内边距为左右 13、上下 9。
  - 气泡尺寸根据文本实际渲染尺寸得出。
- 头像为三层叠加：底图、圆形裁剪的肖像、旋转 180° 的环形框，头像盒 98px。
- 点击我方头像会在管理员男/女头像之间切换，历史消息同步更新，设置按用户保存。
- AI 等待回复时显示加载气泡：三个方块闪烁，出现时由 clip-path 展开。

#### Scenario: 头像显隐与间距
- WHEN 会话依次为：我方、我方、AI、AI、我方
- THEN 头像只出现在第 1、3、5 条上；第 1→2 条和第 3→4 条间距为 14，第 2→3 条和第 4→5 条间距为 33

#### Scenario: 聊天条样式循环
- WHEN 用户连续点击聊天条 3 次
- THEN 样式依次变为 v2 → v3 → v1；刷新后保持最后选中的样式

#### Scenario: 切换我方头像性别
- WHEN 用户点击任一我方头像
- THEN 所有我方头像在管理员男/女之间切换；刷新后保持

## 8. 输入区与表情

- 输入框为 contenteditable，占位文字"发消息"。
- 按 Enter 发送；按 Ctrl/Shift/Cmd+Enter 换行。粘贴时只保留纯文本。
- AI 回复期间输入框禁用，发送按钮变成"停止"按钮。
- 空白内容不能发送。
- 表情：
  - 共 37 个，以 `[sns_emoji_NNN]` token 存储，渲染时显示为高 1em、按原比例缩放的图片。
  - 表情弹层从输入面板顶部向上展开，16 列、每格 60px、间距 16。
  - 点击表情会插入到光标位置；在弹层和触发按钮以外按下指针会关闭弹层。
  - 表情 token 原样发给 AI。

#### Scenario: 发送与换行
- WHEN 用户输入"你好"后按 Shift+Enter，再输入"在吗"，然后按 Enter
- THEN 发出一条两行的我方消息，输入框清空

#### Scenario: 插入表情
- WHEN 用户把光标放在"你好|世界"中间，打开表情弹层并点击第 1 个表情
- THEN 输入框显示"你好[表情图]世界"；发送后消息的存储文本为 `你好[sns_emoji_001]世界`，界面上显示为图片

## 9. AI 回复（流式按行分段）

- 发送链路：前端 `POST /api/conversations/{id}/chat`，请求体为 `{text}`。后端依次：
  1. 校验每日额度；
  2. 保存用户消息，写入 ContextEntry；
  3. 拼装请求消息：第一条 system 为固定系统提示词加世界观；第二条 system 为角色提示词，用户覆盖值优先于内置值；之后接最近 40 条 ContextEntry。
  4. 以 `stream: true` 请求 DeepSeek（`DEEPSEEK_BASE_URL` + `/chat/completions`，模型为 `DEEPSEEK_MODEL`），并把增量以 SSE 转发给前端。
- 前端用 `fetch` + `ReadableStream` + `TextDecoder(stream)` 自行解析 SSE：
  - 用行缓冲处理跨数据块的行和被切开的多字节字符；
  - 识别 `data:` 行、`[DONE]` 结束标记和错误帧。
- 分段显示：先显示加载气泡；累积文本每出现一个完整行（`\n`），就把该行（去掉首尾空白，空行跳过）固化为一个 AI 气泡，然后为后续内容继续显示加载气泡；流结束时剩下的非空文本作为最后一个气泡。
- 每次请求使用独立的 AbortController 和解析器实例。消息状态只能单向变化：生成中 → 完成 / 中断 / 失败。
- 停止生成：点击"停止"会中止请求。已显示的气泡保留，未完成的半行丢弃，加载气泡消失。后端在客户端断开或流结束时，把已完成的行存为 AI 消息，并把完整回复写入 ContextEntry。
- 生成过程中切换到其他会话时，回复仍写回原会话；加载气泡只在查看原会话时显示。
- 错误处理：
  - DeepSeek 返回的错误（401/429/5xx/超时）由后端转成 SSE 错误帧；
  - 前端在一个 AI 气泡中显示 `[错误: <中文原因>]`，该消息状态为 `failed`；
  - 不会出现空气泡。
- 每日额度：每个用户每天（UTC+8 自然日）最多发送 `DAILY_MESSAGE_LIMIT` 条（默认 100）。超出后后端返回 429，前端提示"今日额度已用完"，并且不保存该消息。
- DeepSeek API Key 只存在后端环境变量中。前端产物和浏览器发出的任何请求都不包含它。

#### Scenario: 流式按行逐条出现
- WHEN 用户发送消息，AI 返回的流依次包含"第一行\n第二"和"行\n第三行"
- THEN 收到第一个数据块后立即出现气泡"第一行"；第二个数据块到达后出现"第二行"；流结束后出现"第三行"。共 3 个 AI 气泡，刷新后仍为 3 条

#### Scenario: 停止生成
- WHEN AI 已显示 1 个气泡、第二行尚未收完时，用户点击"停止"
- THEN 请求中止，保留第 1 个气泡，加载气泡消失，输入框恢复可用；刷新后该会话只有这 1 条 AI 消息

#### Scenario: 上游错误提示
- WHEN DeepSeek 返回 401 或请求超时
- THEN 会话中出现一个 AI 气泡，内容为 `[错误: …]` 形式的中文原因；输入框恢复可用

#### Scenario: 切换会话时回复写回原会话
- WHEN AI 正在回复"陈千语"会话时，用户切换到"洛茜"会话
- THEN "洛茜"会话不出现加载气泡或回复；切回"陈千语"后能看到完整回复

#### Scenario: 上下文只带最近 40 条
- WHEN 某会话已有 60 条上下文记录，用户再发送一条消息
- THEN 发给 DeepSeek 的 messages 为 2 条 system 加最近 40 条上下文（包含本条）；可见消息仍为全部

#### Scenario: 每日额度
- WHEN 用户当天已发送 `DAILY_MESSAGE_LIMIT` 条消息后再次发送
- THEN 界面提示"今日额度已用完"，这条消息不出现在会话中，也不调用 DeepSeek

#### Scenario: API Key 不外泄
- WHEN 检查前端构建产物和浏览器开发者工具的网络请求
- THEN 都不包含 DeepSeek API Key

## 10. 对话管理（针对当前会话）

- 没有选中会话时，只显示"请先在左侧选中一段对话，再进行操作。"
- 提供三个操作，每个都要先经过确认页（确认/取消）：
  - 删除对话：删除后自动选中相邻会话。某角色只剩最后一个会话时，按钮禁用，并用 title 说明原因。
  - 清空消息：只清可见消息，AI 上下文保留。
  - 清空上下文：只清 AI 上下文，可见消息保留。

#### Scenario: 删除对话
- WHEN 某角色有 2 个会话，用户删除当前会话并确认
- THEN 该会话消失，相邻会话被选中；刷新后仍然只剩 1 个
- WHEN 该角色只剩 1 个会话
- THEN "删除对话"按钮为禁用状态

#### Scenario: 清空消息与清空上下文互不影响
- WHEN 用户执行"清空消息"后继续提问"我刚才说了什么"
- THEN 界面上旧消息消失，但 AI 仍能引用之前的对话内容
- WHEN 用户执行"清空上下文"
- THEN 界面消息保留，之后 AI 不再记得之前的内容

## 11. 设置对话框

共 6 个标签页：

1. AI 配置：
   - 温度滑块 0–2，步长 0.1；最大 Token 数输入 1–8192。点击"保存"后按用户存储，"恢复默认"恢复为 0.8 / 2048。
   - "连接测试"调用后端 `/api/ai/ping`，由后端向 DeepSeek 发一次最小请求，结果显示为"连接成功"或"连接失败：原因"。
   - 显示当前模型名（只读，来自后端）和今日剩余额度。
2. 世界观设定：textarea 编辑，提供"保存"和"恢复默认"。
3. 角色提示词：
   - 下拉选择 29 个角色之一，打开时默认选中当前会话的角色；已修改的角色显示"已自定义"徽标。
   - 提供"保存"和"恢复默认"。保存空内容或保存与内置提示词相同的内容时，删除该角色的覆盖记录。
4. 数据管理：
   - 显示统计"干员 N · 对话 N（有内容的）· 消息 N"。
   - 提供"删除全部对话"（每个角色只保留一个空会话）、"清空全部消息"、"清空全部上下文"，都需要二次确认。
5. 免责声明：静态文本，内容沿用原项目。
6. 关于：更新日志、项目链接、技术栈说明，以及"退出登录"按钮。

#### Scenario: 修改角色提示词
- WHEN 用户为"陈千语"保存自定义提示词
- THEN 下拉框里该角色显示"已自定义"；之后该角色的请求使用新的提示词
- WHEN 用户点击"恢复默认"
- THEN 徽标消失，之后使用内置提示词

#### Scenario: 连接测试
- WHEN 后端配置了有效的 DeepSeek Key，用户点击"连接测试"
- THEN 显示"连接成功"
- WHEN Key 无效
- THEN 显示"连接失败"和原因

#### Scenario: 数据管理批量操作
- WHEN 用户点击"删除全部对话"并确认
- THEN 每个角色只剩 1 个空会话，统计中的对话数和消息数变为 0

## 12. 工程化

- 前端：
  - ESLint（flat config，含 react-hooks 规则）+ Prettier；
  - `tsc --noEmit`；
  - Vitest + React Testing Library，覆盖 SSE 解析、按行分段、头像显隐与间距规则、表情 token 与 HTML 互转、登录表单、路由守卫。
- 后端：ruff（lint + format）+ pytest，覆盖鉴权、数据隔离、会话 CRUD、上下文截断、每日额度、SSE 转发（mock DeepSeek）、错误帧。
- E2E：Playwright，覆盖注册 → 登录 → 选角色 → 发消息 → 看到按行出现的回复气泡。E2E 环境中后端使用 mock AI（`AI_MOCK=1`），不调用真实 DeepSeek。
- Git：
  - 仓库根目录 `.gitignore` 排除旧项目、`node_modules`、`.venv`、`.env`、数据库文件、构建产物，以及 `.comet/` 中除 `config.yaml` 以外的内容。
  - husky + lint-staged 在提交前检查暂存文件；commitlint 强制 Conventional Commits。
  - 远程仓库为 `git@github.com:Youri2000/baker-chat.git`（用户已创建的空仓库，本机 SSH 已可认证）；Build 阶段配置 `origin`、推送 `main`，GitHub Actions 的最近一次运行必须通过。
- CI（GitHub Actions，push 和 PR 时触发）：
  - frontend 任务：install → lint → typecheck → test → build；
  - backend 任务：ruff → pytest；
  - e2e 任务：依赖前两个任务，运行 Playwright。
- 本地运行：
  - `docker compose up` 一键启动前后端，前端在 http://localhost:5173，后端在 http://localhost:8000；
  - 也支持分别运行 `pnpm dev` 和 `uvicorn`。
  - 前后端各提供 `.env.example`。
- 线上部署：
  - 前端部署到 Vercel，通过 `VITE_API_BASE_URL` 指向后端；后端部署到 Render（Docker），数据库用 Neon Postgres，CORS 白名单由 `CORS_ORIGINS` 配置。
  - 提供部署配置文件和 `docs/deploy.md` 分步文档；账号注册和控制台操作由用户完成，Agent 协助排错。
- 文档：
  - README：项目介绍、架构图、技术栈、本地启动、测试命令、线上地址。
  - `docs/interview.md`（面试讲稿，"注释中简要说，文档里细致讲"）：
    - 项目概览：定位、架构图、数据流。
    - 技术选型表：每项列出候选方案、取舍理由、最终结论。
    - 技术亮点（至少 8 个）：每个按 背景与问题 → 技术调研与选型 → 如何发现问题 → 如何解决 → 结果与代价 五段写，附代码路径；对应代码处有 💡 注释指回文档锚点。
    - 优化记录（至少 3 项）：测量方法、优化前后实测数据、复现步骤；数据必须实际测量。候选项：首个 AI 气泡出现时间、流式过程中消息行重渲染次数、前端产物体积、单次请求 prompt tokens。
    - 问题排查记录（至少 5 条）：现象 → 定位方法 → 根因 → 修复 → 验证。
    - 可改进之处、面试问答速查。
    - 在 Build 过程中随做随记。
