# 前端基础设施（frontend-foundation）

记录搭建 `frontend/` 骨架（工具链、样式令牌、lib、三个 store、共享组件、测试设施）时的选型、问题与实测数据。日期 2026-09-24。

## 1. 技术选型

| 项目                       | 候选                                                                                                                                                                                                                                                  | 放弃理由                                                                                                                                     | 结论                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本基线                   | 今日最新：Vite 8.3 / react-router 8.4 / ESLint 10.11 / TypeScript 7.0（Go 版 tsc）                                                                                                                                                                    | 任务与 conventions 指定 Vite 7、react-router v7、ESLint 9；TS 7 是新编译器，`tsc -b` 行为与 typescript-eslint 8.70 的 peer（`<6.1`）都不匹配 | 锁到 `vite ^7.3.6`、`react-router ^7.18.4`、`eslint ^9.39.5`、`typescript ~5.9.3`；vitest 用 4.1.11（peer 支持 vite 7），jsdom 27.4（30 与 RTL 兼容性未知，不冒险）                       |
| SSE 解析                   | ① `EventSource` ② 第三方 `@microsoft/fetch-event-source` ③ 手写 fetch + ReadableStream                                                                                                                                                                | ① 只支持 GET、不能带 `Authorization` 头，而对话接口是带 JWT 的 POST；② 引入依赖换取的只是重连与解析，本项目不需要重连（后端一次性流）        | 手写 60 行：`TextDecoder.decode(chunk, {stream:true})` 处理跨块多字节字符，`takeCompletedLines` 做行缓冲；同一个函数也被 chatStore 用来把 delta 切成气泡行                                |
| 401 处理与分层             | ① `lib/http.ts` 直接 `import useAuthStore`（lib→features 反向依赖，且 authStore→api→http→authStore 形成循环引用）② `window.location.assign('/login')`（整页刷新，内存里的 toast 会丢）③ http 暴露 `onUnauthorized(handler)`，authStore 加载时注册一次 | ①违反"lib 与业务无关"并产生循环 import；②"提示 + 跳转"做不到同时满足                                                                         | ③：http 层清 localStorage token 并调用处理器；处理器把 store 的 token 置 null 并 toast；`RequireAuth` 订阅 token，为 null 即 `<Navigate replace>`，不需要在组件外拿 navigate              |
| 登录 401 与过期 401 的区分 | 按接口路径白名单（/auth/login 不算过期）                                                                                                                                                                                                              | 路径硬编码在 lib 里是业务泄漏                                                                                                                | 按"请求是否带了 token"判断：带 token 的 401 才是过期；并发多个 401 只触发一次（第二个响应到达时 token 已被清）                                                                            |
| 登录成功跳转               | `useNavigate()` 后命令式跳转                                                                                                                                                                                                                          | 多一个 hook，且"已登录访问 /login 跳 /"也要写一遍                                                                                            | 页面顶部 `if (token !== null) return <Navigate to="/" replace />`，登录成功 token 变化后同一行代码完成跳转                                                                                |
| 令牌输出策略               | 默认 `@theme`（只输出被工具类引用的变量）                                                                                                                                                                                                             | UI agent 会在 SVG `fill`、内联 `style` 里写 `var(--color-bubble-other)`，Tailwind 扫描不到这些引用，变量会缺失                               | `@theme static`：全部令牌无条件输出。代价：CSS 15.24 KB → 17.47 KB（gzip 3.97 → 4.57 KB）                                                                                                 |
| 动画时长令牌               | `--duration-*` 命名空间                                                                                                                                                                                                                               | Tailwind v4 theme.css 里没有 duration 命名空间（只有 `--default-transition-duration`），`duration-*` 只接受裸数字                            | 自定义 `--anim-*` 变量，用法 `duration-(--anim-fast)`；已在构建产物里验证生成 `transition-duration:var(--anim-dialog)`                                                                    |
| store 错误处理             | 动作 reject 让组件各自 catch                                                                                                                                                                                                                          | 每个调用点都要写 catch + toast，重复                                                                                                         | 除 `auth.login/register`（表单要显示原因）外，所有 store 动作内部 `toastError`，不 reject；`toastError` 对 401 静默（登录态处理已经提示过）                                               |
| 表情图片打包               | 默认 `assetsInlineLimit`（<4 KB 内联 base64）                                                                                                                                                                                                         | 37 张小图会被塞进主 JS                                                                                                                       | `import.meta.glob(..., {query:'?no-inline'})`，Vite 7 的 `noInlineRE` 已确认支持                                                                                                          |
| 头像加载                   | 29 个显式 import                                                                                                                                                                                                                                      | 冗长且容易漏                                                                                                                                 | `import.meta.glob('../assets/avatars/*.webp', {eager, import:'default', query:'?url'})` + 文件名查表，缺文件构建期即抛错                                                                  |
| jsdoc 强制范围             | `require-jsdoc` 对所有 `ArrowFunctionExpression` 开启                                                                                                                                                                                                 | `useEffect(() => …)`、`map((x) => …)` 这类内联回调也会被要求写注释                                                                           | `FunctionDeclaration: true` + `contexts` 只匹配 `Program/ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression`，即"赋给模块级或导出变量的箭头函数" |
| Zustand 对象里的 action    | 也用 lint 强制 JSDoc（`Property > ArrowFunctionExpression`）                                                                                                                                                                                          | 这个 selector 同样会命中 `streamSse(..., { onDelta: () => … })` 的回调                                                                       | 不用 lint 强制，靠约定：三个 store 的每个动作都在 interface 上写了 JSDoc                                                                                                                  |

## 2. 遇到的问题

### 2.1 `new TextDecoder('utf-8', { stream: true })` 类型错误

- 现象：`tsc -b` 报 `'stream' does not exist in type 'TextDecoderOptions'`。
- 定位：任务描述里的写法把 `stream` 放在构造函数；查 lib.dom.d.ts，`TextDecoderOptions` 只有 `fatal`/`ignoreBOM`，`stream` 属于 `decode()` 的第二参数。
- 根因：API 记错位置。
- 修复：`new TextDecoder('utf-8')` + `decoder.decode(value, { stream: true })`。
- 验证：`sse.test.ts` "中文多字节字符被切在两个 chunk 之间" 用例：把 `data: {"delta":"第一行"}\n` 编码后在"行"的第 2 个字节处切开分两次推送，`onDelta` 收到完整的 `第一行`。

### 2.2 手写 SSE 桩流在 abort 后不会唤醒读取

- 现象：`chatStore` "stopGeneration 后 bubbles 保留到重拉完成" 用例失败，`pending` 一直是 `true`。
- 定位：在 `streamSse` 里加断点看，`stopGeneration()` 之后代码停在 `await reader.read()`。
- 根因：真实 `fetch` 被 abort 时，body 流会让挂起的 `read()` 以 `AbortError` 拒绝；测试里用 `new ReadableStream()` 手写的流不知道 signal，`read()` 永远挂着。
- 修复：测试在 abort 后再推一块数据唤醒读取，`streamSse` 读到数据后先检查 `signal.aborted` 直接返回——这条守卫本来就需要（`sse.test.ts` "abort 后不再回调"），顺便让两条路径（read 拒绝 / read 返回）都被覆盖。
- 验证：用例通过；abort 之后推送的 `行\n第三行\n` 没有进入 bubbles，半行"第二"被丢弃。

### 2.3 Prettier 的 Tailwind 插件没有识别 `@theme` 令牌

- 现象：`prettier --write` 后 `bg-card-bg`、`text-text-primary` 被排到 class 串最前面（未知类的位置），布局类反而在后面。
- 定位：`node -e "require.resolve('tailwindcss')"` 在仓库根目录 `MODULE_NOT_FOUND`，在 `frontend/src/styles` 下能解析到 `.pnpm/tailwindcss@4.3.3`；插件（0.6.14）以配置文件所在目录为基准解析 `tailwindcss`，失败后回退到内置的 v3 排序。
- 根因：pnpm 严格的 node_modules 结构 + `tailwindcss` 只在 `frontend` 里声明，根目录的 `.prettierrc` 找不到它。
- 修复：不在本任务范围（根目录文件不能改）。给主会话的建议二选一：根 `package.json` 加 `tailwindcss` devDependency；或根 `.npmrc` 加 `public-hoist-pattern[]=tailwindcss`。
- 验证：目前只验证了根因；修复后应看到 `flex bg-card-bg` 这类排序（布局在前、颜色在后）。

### 2.4 `grep -c` 计数为 0 时 `&&` 链中断

- 现象：验证脚本"--- css checks"整段没有输出。
- 根因：`ls dist/assets | grep -c sns_emoji` 结果为 0 时 grep 退出码是 1，后面用 `&&` 连接的命令全部跳过。
- 修复：改用 `;` 分隔并把 emoji 计数单独解释：`constants/emoji.ts` 还没被任何页面 import，Vite 不会输出未引用的资源，0 是正确的。

## 3. 实测数据

| 指标                                   | 数值                                                                                                                                 | 复现                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `pnpm install`（根，含 husky prepare） | 3 min 16 s，414 packages                                                                                                             | `pnpm install`                             |
| `pnpm lint`                            | 0 error 0 warning                                                                                                                    | `cd frontend && pnpm lint`                 |
| `pnpm typecheck`                       | 通过                                                                                                                                 | `pnpm typecheck`                           |
| `pnpm test`                            | 7 文件 40 用例全部通过，1.2 s                                                                                                        | `pnpm test`                                |
| `pnpm build`                           | ✓ 0.54 s；`index.css` 17.47 KB（gzip 4.57 KB）；`index.js` 282.01 KB（gzip 90.71 KB）                                                | `pnpm build`                               |
| `@theme static` 的代价                 | CSS 15.24 → 17.47 KB，gzip 3.97 → 4.57 KB                                                                                            | 对比 `@theme` / `@theme static` 两次 build |
| 字体文件                               | `HarmonyOS_Sans_SC_Medium.woff2` 4.32 MB（未子集化，全量 CJK）                                                                       | `du -sh frontend/src/assets/fonts/*`       |
| 素材                                   | 头像 31、表情 37、materials 29（原 47 张 webp/png，剔除导出/ZIP/背景上传/移动端专用 18 张）                                          | `ls frontend/src/assets/*`                 |
| dev 冒烟                               | `GET /` 200（933 B，含 `#root` 与 `<title>//BAKER/会话消息</title>`）；`GET /src/styles/index.css?direct` 200 且含 `--color-card-bg` | `pnpm dev` + `curl`                        |

## 4. 可作为面试"优化记录"的候选

- 字体 4.32 MB 是当前最大的资源；`font-display: swap` 保证不阻塞首屏，但可以用 `pyftsubset` 按 29 个角色名 + 界面文案 + 常用汉字子集化，预计降到几百 KB。测量方法：`ls -l dist/assets/*.woff2` + Chrome Network 面板的字体下载耗时。
- 与原项目行为核对：原 `main.ts` 在挂载前 `await document.fonts.load(...)`，原因是 canvas `measureText` 测气泡宽度依赖字形；新项目气泡尺寸由 DOM 排版得出，字体晚到只触发一次回流，所以只保留 `font-display: swap`，不再阻塞挂载。

## 5. 留给后续 agent 的注意点

- `index.css` 已冻结：颜色/字号/圆角/动画/时长令牌齐全；原项目 Vue `<Transition>` 的 collapse / chat-input-pop / 对话框淡入已转成 `animate-collapse-in` / `animate-pop-up` / `animate-dialog-in`（只有进入动画，退出直接卸载）。
- `--animate-end-deco-in` 与 `chat_end_deco` 素材：原项目只在 PNG 导出模式显示末尾装饰，素材没有复制；keyframe 按任务要求保留，如无消费者可由主会话删除。
- 表情 `<img>` 要显式 `inline`（preflight 把 img 设为 `display:block`）。
- `scroll-mask` 的 calc 参数写法：`[--mask-bottom-in:calc(100%_-_80px)]`（下划线代空格）。
