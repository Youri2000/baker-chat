# 后端（FastAPI）开发笔记

面试讲稿的原始素材。所有数据都是 2026-09-24 在本机（macOS，Python 3.13.5）实测。

## 1. 技术选型

| 决策点           | 候选                                                                    | 放弃理由                                                                                                                                  | 结论                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 密码哈希         | passlib[bcrypt] / 直接用 bcrypt                                         | passlib 1.7.4 自 2020 年停更，和 bcrypt ≥4.1 不兼容（读不到 `bcrypt.__about__`，登录时报 `AttributeError`）；多一层没有收益               | 直接 `bcrypt.hashpw / checkpw`，两个函数各一行。bcrypt 5.0 对超过 72 字节的口令直接抛 `ValueError`，所以在 `schemas.AuthRequest` 入口拒绝 >72 字节的口令（30 个汉字就是 90 字节） |
| ORM 会话模型     | 异步 SQLAlchemy（aiosqlite / asyncpg） / 同步 Session                   | 异步驱动要为 SQLite 与 Postgres 各装一套；而流式回复落库恰恰需要"不会被取消打断"的同步代码                                                | 同步 Session。普通路由用 `def`，由 FastAPI 放到线程池；只有 `/chat` 的流式生成器是 `async`，它的 `finally` 里用一个新的同步 `SessionLocal()` 写库                                 |
| 上游调用         | openai SDK / httpx 手写                                                 | SDK 把 HTTP 状态码和 SSE 帧都封装掉了，按契约把 401/429/5xx/超时映射成中文原因反而要拆它的异常层级                                        | `httpx.AsyncClient.stream` + `aiter_lines`，解析 `data:` 行约 20 行代码，超时用 `httpx.Timeout(connect=10, read=60, write=10, pool=10)`                                           |
| 上游错误传递     | 生成器 yield 错误对象 / 抛 `UpstreamError`                              | 用返回值传错误会让每一层都要判断                                                                                                          | `ai.stream_chat` 只抛 `UpstreamError(中文原因)`，`chat.stream_reply` 一处 `except` 转成 `{"error": …}` 帧                                                                         |
| 时间列           | naive UTC / aware UTC + `TypeDecorator`                                 | SQLite 存不下时区，读回来是 naive；Pydantic 序列化 naive 值没有 `Z`，浏览器 `new Date("2026-09-24T05:00:00")` 会当本地时间解析，差 8 小时 | 存 aware UTC，`UtcDateTime` 在读库时给 naive 值补 `UTC`，响应统一是 `…Z`（curl 实测 `"created_at": "2026-09-24T05:42:21.658303Z"`）                                               |
| 角色提示词存放   | Python 字典字面量 / JSON 数据文件                                       | 40 万字节的 `.py` 每次 ruff / format 都要扫，还要为它关掉 E501；放前端常量则 393,586 字节的 TS 全部打进产物                               | `app/data/character_prompts.json`（401,446 字节，29 条，共 143,325 字，最短 4,165 字、最长 5,996 字），启动时 `json.loads` 一次实测 0.42 ms                                       |
| 依赖注入写法     | `db: Session = Depends(get_db)` / `Annotated[Session, Depends(get_db)]` | ruff B008 会把默认参数里的 `Depends()` 当函数调用报错，需要 `extend-immutable-calls` 配置去豁免                                           | 全部用 `Annotated` 别名（`DbDep`、`UserDep`、`ConversationDep`），零配置                                                                                                          |
| 测试数据库       | `dependency_overrides[get_db]` / 重绑 `SessionLocal`                    | 流式生成器 `finally` 里的 `SessionLocal()` 不经过依赖注入，override 覆盖不到它                                                            | `SessionLocal.configure(bind=test_engine)` 一处生效；测试引擎用 `StaticPool` 单连接内存库，因为线程池里的路由和事件循环里的落库必须看到同一个内存库                               |
| 鉴权头解析       | FastAPI 默认 `HTTPBearer()` / `HTTPBearer(auto_error=False)`            | 默认实现缺 header 时返回 403 "Not authenticated"，与契约的 `401 未登录或登录已过期` 不符                                                  | `auto_error=False`，缺失 / 非 Bearer / 解析失败 / 用户不存在四种情况共用一个 401                                                                                                  |
| SQLite 主键      | 默认 rowid / `sqlite_autoincrement`                                     | 默认 rowid 在表清空后会从 1 重新分配，Postgres 的序列不会；两种环境行为不一致会把前端"按 id 缓存"类 bug 藏到线上才暴露                    | 所有表加 `sqlite_autoincrement=True`，SQLite 与 Postgres 语义一致                                                                                                                 |
| 每日额度的"今天" | 服务器本地时区 / 固定 UTC+8                                             | 线上（Render）容器是 UTC，本地是 CST，用本地时区会让额度在两边不一样                                                                      | `CHINA_TZ = timezone(timedelta(hours=8))`，把当天 0 点换算成 UTC 再和 `created_at` 比较；SQLite 存的是 UTC 墙钟字符串，字符串比较仍然正确                                         |

## 2. 流式回复的持久化设计（面试主讲点）

`POST /conversations/{id}/chat` 有三种结束方式，都必须落库：

1. 上游正常发完 `[DONE]` → `completed`，完整回复写入 `ContextEntry`。
2. 上游 / 网络出错 → 先发一帧 `{"error": 中文原因}` 再 `[DONE]`；已收到的行照常保存，再追加一条 `[错误: …]` 的 `failed` 消息；不写上下文。
3. 客户端断开 → Starlette 检测到 `http.disconnect` 后取消任务，生成器在 `await` 处收到 `CancelledError`（直接 `aclose()` 时是 `GeneratorExit`）→ `aborted`，未完成的半行丢弃，上下文只写已完成的行。

实现要点：`stream_reply` 里 `status` 默认就是 `"aborted"`，只有循环自然跑完才改成 `"completed"`；持久化放在 `finally`，并且是同步代码——asyncio 的取消只能在 `await` 处投递，同步的 `SessionLocal()` 写库不会被打断。测试分别覆盖了 `aclose()`（`test_client_disconnect_persists_completed_lines_as_aborted`）和 `task.cancel()`（`test_task_cancellation_persists_as_aborted`）两条路径。

真实服务器验证（AI_MOCK=1，`curl -N --max-time 0.25`）：250 ms 内收到 3 帧（"收到，管理" / "员。\n这是" / "一条来自 "），断开后库里只有 1 条 `other` 消息 `收到，管理员。`，状态 `aborted`，半行"这是一条来自 "被丢弃；uvicorn 日志没有任何 Traceback。

## 3. 遇到的问题

### 3.1 ruff D415 把所有中文 docstring 都报错

- 现象：首次 `ruff check` 报 88 个 `D415 First line should end with a period, question mark, or exclamation point`，每个 docstring 都中招。
- 定位：ruff 的 D415 只认 ASCII 的 `.`、`!`、`?`，中文句号 `。` 不算。
- 根因：规则本身不支持 Unicode 句末标点。
- 修复：`pyproject.toml` 里 `ignore = ["D415"]` 并注释原因；D 规则其余部分（D100–D107 缺 docstring）保持强制。
- 验证：`ruff check .` 通过（开发过程中缺 docstring 的测试函数曾被 D103 拦下）。

### 3.2 E501 对中文按 2 列计宽

- 现象：几行中文注释 / docstring 明明不到 65 个字符却报 `E501 Line too long (104 > 100)`。
- 定位：ruff 用 unicode-width 计算列宽，一个汉字算 2 列，100 列只够约 50 个汉字。
- 修复：拆行、缩短注释；`characters.py` 里逐字迁移的提示词必须保持原文，用 `per-file-ignores` 单独关掉 E501。
- 验证：`ruff check .` 通过。

### 3.3 SQLite 复用已删除的 id

- 现象：`test_delete_all_conversations_leaves_one_empty_per_character` 失败：`assert 1 not in {1, 2, 3, …}`，删掉全部会话再新建 29 段后，新会话的 id 又从 1 开始。
- 定位：单独执行 SQL 验证，SQLite 不带 `AUTOINCREMENT` 的 `INTEGER PRIMARY KEY` 用 `max(rowid)+1` 分配。
- 根因：SQLite 与 Postgres 在主键分配上的语义差异。
- 修复：所有模型 `__table_args__ = {"sqlite_autoincrement": True}`。
- 验证：该用例通过；全套 64 个用例通过。

### 3.4 一次性抽取脚本把 `Character[]` 里的 `]` 当成数组结尾

- 现象：Node 脚本报"prompts.ts 多出角色: 伊冯,余烬,…"，即从 `character.ts` 解析出的角色名列表为空。
- 定位：打印切片发现 `export const CHARACTERS: Character[] = [` 这一行里类型注解的 `]` 先被 `indexOf(']')` 命中，切片为空。
- 修复：从 `= [` 之后开始找结尾的 `]`。
- 验证：脚本输出 `names=29 prompts=29`，JSON 顺序与 `CHARACTERS` 一致；`tests/test_characters.py` 用 Python 正则独立再解析一遍 TS 源文件，与 JSON 逐字比对通过（三条比对用例在原项目缺席时自动 skip）。

### 3.5 FastAPI 0.141 的 `app.routes` 看起来"没注册路由"

- 现象：冒烟脚本打印 `app.routes` 只看到 `/health` 和文档路由，6 个 `include_router` 的结果是 6 个没有 `path` 属性的对象。
- 定位：打印对象类型发现新版 FastAPI（配 Starlette 1.7）把子路由整个挂成嵌套 router，不再把每条路由摊平到 `app.routes`。
- 根因：框架行为变化，不是 bug。
- 验证：`TestClient` 请求 `/api/auth/register` 返回 201，curl 全流程正常。

### 3.6 PyJWT 对短密钥告警

- 现象：`JWT_SECRET=test` 启动后日志出现 `InsecureKeyLengthWarning: The HMAC key is 4 bytes long…`。
- 根因：PyJWT 2.10+ 按 RFC 7518 要求 HS256 密钥至少 32 字节。
- 修复：`.env.example` 注明至少 32 字节并给出 `openssl rand -hex 32`；测试用 35 字节密钥，告警消失。

## 4. 可量化数据

| 指标                      | 数值                                                                                                              | 测量方法                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 角色提示词总量            | 29 条，143,325 字，JSON 401,446 字节；原 TS 文件 393,586 字节                                                     | `wc -c` 与 Python 统计                                      |
| 启动时加载提示词          | `json.loads` 平均 0.42 ms                                                                                         | `timeit` 20 次取平均                                        |
| 每次上游请求的固定 prompt | 固定系统提示词 1,122 字 + 默认世界观 256 字 + 角色提示词 4,165–5,996 字；以陈千语为例约 7,374 字、粗估 4.9k token | 字符数统计（真实 token 数待接真实 Key 后用 `usage` 帧核对） |
| 上下文截断                | 60 条历史 + 本条 → 发给上游 42 条消息（2 system + 40）                                                            | `test_context_window_keeps_last_40` 断言 respx 捕获的请求体 |
| bcrypt 哈希耗时           | 平均 169 ms（默认 12 轮）                                                                                         | `timeit` 3 次；注册 / 登录接口的延迟主要在这里              |
| mock 流时序               | 首字节 6.6 ms，7 帧 × 80 ms，总计 579 ms                                                                          | `curl -N -w '%{time_starttransfer} %{time_total}'`          |
| 测试                      | 64 个用例 11.8 s；`app/` + `tests/` 共 2,044 行                                                                   | `pytest -q`、`wc -l`                                        |

## 5. 待后续核对

- 接上真实 DeepSeek Key 后，用 `usage` 帧记录截断前后的 `prompt_tokens`（优化记录候选）。
- Starlette 1.7 把基于 httpx 的 `TestClient` 标记为 deprecated（提示装 `httpx2`），目前只是告警；升级时再处理。
