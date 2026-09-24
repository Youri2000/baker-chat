# 工程约定

本仓库所有代码（前端、后端、E2E、配置）共同遵守的约定。评审和验收都以本文件为准。

## 1. 五板斧

1. 严禁超前设计：没有第二个真实调用点之前不抽象，不为"以后可能"留接口、参数或配置。
2. 严禁过度工程：不设 `utils` 杂物箱，不加 service / repository 层，不引入第二套解决同一问题的方案。
3. 严禁防御未出现的错误：只在真实边界（网络、鉴权、上游 AI、用户输入、文件/环境）处理错误；纯逻辑不包 try/catch，不为不可能出现的状态写分支。
4. 严禁向后兼容：不迁移旧数据、不保留旧字段名、旧路径、旧参数。
5. 严禁胶水代码：需要重构就直接重构；死代码删除而不是注释掉。

## 2. 前端

- React 19 + TypeScript strict + Vite + Tailwind CSS v4 + Zustand + React Router。
- 只写函数组件 + Hooks，不写 class component（因此没有 ErrorBoundary）。
- 文件命名：组件 `PascalCase.tsx`，Hook `useXxx.ts`，其余 `camelCase.ts`；一个文件一个组件；一律具名导出。
- 目录：

  ```text
  src/
    main.tsx            入口
    App.tsx             路由与全局 Provider
    styles/index.css    唯一的全局样式：@import tailwindcss、@theme、@font-face、@utility
    assets/             头像、表情、素材、字体（从原项目复制）
    constants/          角色列表、表情表、设计尺寸等纯数据
    lib/                http.ts（fetch 封装）、sse.ts（SSE 解析）等与业务无关的代码
    components/         跨功能共享 UI（DialogShell、Toast、DesignCanvas 等）
    features/
      auth/             登录、注册、authStore、路由守卫
      characters/       角色主卡、子卡列表
      chat/             聊天区、气泡、输入、表情、chatStore、流式逻辑
      settings/         设置对话框、对话管理、数据管理、settingsStore
    test/               测试公共设置（setup.ts、mock 工具）
  ```

- 路径别名 `@/` 指向 `src/`。
- Props 用 `interface XxxProps`；事件回调 prop 命名 `onXxx`，组件内处理函数 `handleXxx`。
- 状态：每个 feature 一个 Zustand store（`xxxStore.ts`），组件用选择器订阅需要的字段。
- 样式：只用 Tailwind 工具类；设计稿数值用任意值原样写（`left-[546.02px]`、`text-[20.88px]`），同一数值出现 3 次以上时提为 `@theme` 令牌；动态数值（zoom、SVG 宽高、clip-path 进度）用内联 `style` 或 SVG 属性；条件 class 用 `clsx`；状态样式用 `data-*` 属性 + `data-*:` 变体；不用 `@apply`。
- Lint / 格式：ESLint（typescript-eslint、react-hooks、react-refresh、jsdoc）+ Prettier（`prettier-plugin-tailwindcss` 排序 class）。
- 测试：Vitest + React Testing Library，测试文件与源码同目录，命名 `xxx.test.ts(x)`。

## 3. 后端

- Python 3.13 + FastAPI + SQLAlchemy 2 + Pydantic v2 + pydantic-settings + httpx。
- 单个 `app/` 包：

  ```text
  app/
    main.py         创建 FastAPI、注册路由、启动时建表和种子
    config.py       Settings（pydantic-settings）
    db.py           engine、SessionLocal、Base、get_db
    models.py       SQLAlchemy 模型
    schemas.py      Pydantic 请求/响应模型
    deps.py         get_current_user 等依赖
    security.py     密码哈希、JWT
    ai.py           DeepSeek 客户端（流式 / ping / mock）
    characters.py   29 个角色的内置提示词、固定系统提示词、默认世界观
    routers/        auth.py、conversations.py、chat.py、settings.py、prompts.py、data.py
  tests/            pytest，使用内存 SQLite 与 mock 上游
  ```

- 全量类型注解；ruff 启用 `E, F, I, UP, B, N, D`（Google docstring 约定）；`ruff format`。
- 不设 service / repository 层，路由函数直接操作 session。

## 4. 注释规范（中文）

- 每个源文件顶部有文件级文档注释，说明职责和与谁协作（JSON 文件除外；YAML/配置文件用 `#`）。
- 每个函数、组件、Hook、store、路由处理器、模型和测试用例都有文档注释：
  - TS：JSDoc `/** */`，说明用途；参数和返回值只在类型不能自明时补充。
  - Python：Google 风格 docstring。
- 关键逻辑加单行注释：
  - 解释接下来一段逻辑或某个步骤 → 独占一行，放在其上。
  - 标注单个表达式、字段或常量值 → 放在同一行末尾，不超过约 40 个字。
- emoji 只用三种，每个文件不超过 5 处，普通注释不加：
  - ✅ 核心功能代码
  - ⚠️ 易错或关键代码（竞态、闭包、编码、边界、取消）
  - 💡 设计取舍或优化结论，只写一两句，并指向 `docs/interview.md` 的锚点，例如 `// 💡 手写 SSE 解析而非 EventSource：需要 POST + 自定义头，详见 docs/interview.md#sse`
- 注释解释"为什么"和"做什么"，不复述代码；标识符保持英文。
- 文档注释的存在性由 ESLint `jsdoc/require-jsdoc` 和 ruff `D` 规则强制。

## 5. Git

- Conventional Commits：`feat: …`、`fix: …`、`docs: …`、`test: …`、`chore: …`、`refactor: …`、`ci: …`；主题用中文或英文均可，一次提交只做一件事。
- 提交前 husky + lint-staged 自动 lint 和格式化暂存文件；commit-msg 由 commitlint 校验。
- 分支：直接在 `main` 开发；远程 `origin` = `git@github.com:Youri2000/baker-chat.git`。

## 6. 面试素材记录

开发过程中每个人（或 agent）把以下内容随手记到 `docs/notes/<area>.md`，最后汇总进 `docs/interview.md`：

- 技术选型：候选方案、放弃理由、结论。
- 发现的问题：现象 → 定位方法 → 根因 → 修复 → 验证。
- 优化：测量方法、优化前后数据、复现步骤（数据必须实测）。
