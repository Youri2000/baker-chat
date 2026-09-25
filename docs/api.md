# Baker Chat 接口契约

前后端共同遵守的 HTTP 契约。前端 `frontend/src/lib/http.ts` 与 `features/*/api.ts` 按此调用；后端 `backend/app/routers/*` 按此实现；任何一方要改字段，先改本文件。

- Base path：`/api`（前端通过 `VITE_API_BASE_URL` 指向后端根地址，开发时为 `http://localhost:8000`）
- 编码：请求与响应均为 JSON（`Content-Type: application/json`），SSE 接口除外
- 鉴权：除 `auth/register`、`auth/login`、`/health` 外，所有接口要求 `Authorization: Bearer <jwt>`；缺失或无效一律 `401 {"detail": "未登录或登录已过期"}`
- 错误体：统一为 FastAPI 默认格式 `{"detail": "<中文原因>"}`；参数校验失败为 `422`，`detail` 为 FastAPI 的校验数组
- 时间：ISO 8601 字符串，UTC

前端对错误的约定（`lib/http.ts`）：

- 除 `auth/login`、`auth/register` 外，任何接口返回 `401`（不论请求是否带了 token——另一标签页退出后本页的请求已不带 token）都视为登录已过期：清 token、重置会话与设置数据、跳 `/login` 并提示"登录已过期，请重新登录"；并发的多个 401 只提示一次。`auth/login` 的 401 是"用户名或密码错误"，显示在表单里
- `422` 的校验数组取每项的 `msg` 用"；"拼成一句显示，不显示原始 JSON
- 登录、注册、退出登录时前端都把会话与设置数据重置为初始值，上一个用户的数据不会显示给下一个用户

## 1. 鉴权 `/api/auth`

| 方法 | 路径                 | 请求体                 | 成功                | 失败                                 |
| ---- | -------------------- | ---------------------- | ------------------- | ------------------------------------ |
| POST | `/api/auth/register` | `{username, password}` | `201 {token, user}` | `409 用户名已被占用`；`422` 校验失败 |
| POST | `/api/auth/login`    | `{username, password}` | `200 {token, user}` | `401 用户名或密码错误`               |
| GET  | `/api/auth/me`       | —                      | `200 user`          | `401`                                |

- 注册校验：`username`：3–20 位，`^[A-Za-z0-9_]+$`；`password`：6–64 个字符（按 Unicode 码点计），不限字符集；UTF-8 编码超过 bcrypt 的 72 字节上限时 `422`（提示"密码为 6–64 位；含中文时最多 24 个字"），前端表单用同一条规则本地校验
- 登录不做格式校验：`username`、`password` 只要求非空字符串（缺失或为空才 `422`）；凭据不匹配（含用户名或密码格式不合规）一律 `401 用户名或密码错误`，不泄露账号是否存在
- `user = {id: number, username: string}`
- token：HS256 JWT，`sub` 为用户 id 字符串，7 天过期
- 用户首次创建（注册或演示账号种子）时，后端为 29 个内置角色各建一个空会话，并创建默认 `settings`

## 2. 会话与消息 `/api/conversations`

```ts
interface Conversation {
  id: number;
  character_name: string; // 29 个内置角色名之一
  last_message: { side: 'mine' | 'other'; text: string } | null; // 子卡预览用
  created_at: string;
  updated_at: string;
}
interface Message {
  id: number;
  side: 'mine' | 'other'; // mine = 管理员（用户），other = 角色（AI）
  text: string; // 可含 \n 与 [sns_emoji_NNN] token
  status: 'completed' | 'aborted' | 'failed';
  created_at: string;
}
```

| 方法   | 路径                                     | 请求体             | 成功                                                           | 失败                                                       |
| ------ | ---------------------------------------- | ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/conversations`                     | —                  | `200 Conversation[]`（按角色内置顺序，再按 `created_at` 升序） |                                                            |
| POST   | `/api/conversations`                     | `{character_name}` | `201 Conversation`                                             | `422` 角色名不存在                                         |
| DELETE | `/api/conversations/{id}`                | —                  | `204`                                                          | `404` 不存在或不属于当前用户；`409 该角色至少保留一个会话` |
| GET    | `/api/conversations/{id}/messages`       | —                  | `200 Message[]`（按 id 升序）                                  | `404`                                                      |
| POST   | `/api/conversations/{id}/messages/clear` | —                  | `204`（只清可见消息，上下文保留）                              | `404`                                                      |
| POST   | `/api/conversations/{id}/context/clear`  | —                  | `204`（只清 AI 上下文，消息保留）                              | `404`                                                      |
| POST   | `/api/conversations/{id}/chat`           | `{text}`           | `200 text/event-stream`（见第 3 节）                           | `404`；`422` 文本为空；`429 今日额度已用完`                |
| POST   | `/api/conversations/{id}/chat/stop`      | —                  | `200 {stopped: boolean}`（见第 3 节"停止生成"）                | `404`                                                      |

## 3. AI 对话流 `POST /api/conversations/{id}/chat`

后端顺序：

1. 校验会话归属与 `text` 非空（去掉首尾空白后）。
2. 校验每日额度：统计当前用户当天（UTC+8 自然日）`side = 'mine'` 的消息数，达到 `DAILY_MESSAGE_LIMIT` 则返回 `429`，不保存消息。
3. 保存用户消息（`status = 'completed'`）并追加 `ContextEntry(role='user')`。
4. 组装 DeepSeek 请求：
   - `messages[0]`：`system` = 固定系统提示词 + `"\n\n## 世界观设定\n\n"` + 用户世界观（空则用默认世界观）
   - `messages[1]`：`system` = 角色提示词（用户覆盖优先，否则内置）
   - 之后：该会话最近 40 条 `ContextEntry`（含刚追加的这条），`user` / `assistant` 原样映射
   - 请求体：`{model, messages, temperature, max_tokens, stream: true, stream_options: {include_usage: true}, thinking: {type: "disabled"}}`（V4 系列默认开启思考模式，角色闲聊关闭：思考 token 会计入 `max_tokens` 与费用，且答案要等思考结束后整段到达）
5. 以 SSE 转发。

SSE 帧格式（每帧 `data: <json>\n\n`）：

```text
data: {"delta": "第一行\n第二"}        ← 增量文本，原样转发上游 choices[0].delta.content
data: {"delta": "行\n第三行"}
data: {"usage": {"prompt_tokens": 812, "completion_tokens": 45, "prompt_cache_hit_tokens": 768}}   ← 上游最后一帧的 usage，可选；`prompt_cache_hit_tokens` 只在上游返回时带
data: {"error": "上游认证失败（401）"}   ← 出错时发送一帧中文原因，然后立即发 [DONE]
data: [DONE]
```

- 上游错误映射：`401/403` → "上游认证失败（<code>）"；`429` → "上游限流，请稍后再试"；`5xx` → "上游服务异常（<code>）"；超时（连接 10s / 读取 60s）→ "上游响应超时"；其他 → "上游请求失败：<原因>"
- 持久化规则（流结束、上游出错、显式停止、客户端断开时都执行）：把已收到的全文按 `\n` 拆分，去掉每行首尾空白，丢弃空行，每行保存为一条 `other` 消息；正常结束 `status = 'completed'`，显式停止或客户端断开 `status = 'aborted'`（未完成的半行丢弃）；出错时额外保存一条 `other` 消息，文本为 `[错误: <中文原因>]`，`status = 'failed'`
- 上下文：正常结束时把完整回复追加为 `ContextEntry(role='assistant')`；被中断时追加已完成的行；出错时不追加
- `[DONE]` 一定在持久化完成之后才发出：客户端收到 `[DONE]` 时 `GET /messages` 已能读到本次回复
- 请求头：`Cache-Control: no-cache`、`X-Accel-Buffering: no`
- `AI_MOCK=1` 时不请求上游：以 80ms 间隔分块发送固定文本 `"收到，管理员。\n这是一条来自 mock 的回复。\n第三行用于验证分段。"`，用于 E2E、CI 和无 Key 的本地演示

停止生成 `POST /api/conversations/{id}/chat/stop`：

- 后端按会话 id 维护进程内的活动流登记表（条目只在流式生成器运行期间存在，任何结束路径都会移除）。有活动流时置位停止事件：生成器不再等待上游的下一帧、关闭上游连接，按上面的"显式停止"规则落库，**落库完成后才返回** `200 {"stopped": true}`，随后流发送 `[DONE]`
- 没有活动流（已结束或尚未开始）时立即返回 `200 {"stopped": false}`
- 会话归属同样校验：停别人的会话返回 `404`，所以用户停不了别人的流
- 客户端直接断开（关闭标签页等）时仍走生成器的 finally 落库，作为兜底

前端约定：

- 用 `fetch` + `ReadableStream` + `TextDecoder('utf-8', {stream: true})` 解析，按 `\n` 切帧，未完成的尾部留在缓冲区
- 收到 `delta` 后累积文本；每出现一个完整行（`\n`）就把该行（去掉首尾空白、跳过空行）显示为一个 AI 气泡；`[DONE]` 后剩余非空文本作为最后一个气泡（已请求停止时不显示，与后端丢弃半行一致）
- 每次请求独立创建 `AbortController`；停止生成先 `POST …/chat/stop`（返回即代表已持久化），再 `abort()` 兜底结束本地 fetch，已显示的行保留
- 流结束（`[DONE]`、错误、中断）后重新拉取 `GET /messages`，用持久化结果替换本地临时气泡；`[DONE]` 与 stop 的响应都在后端落库之后才发出，所以这次重拉一定读到完整结果

## 4. 设置 `/api/settings`

```ts
interface Settings {
  temperature: number; // 0–2，默认 0.8
  max_tokens: number; // 1–8192，默认 2048
  world_setting: string; // 空字符串表示使用默认世界观；GET 时返回实际生效文本
  world_setting_is_default: boolean;
  my_gender: 'male' | 'female'; // 默认 male
  strip_variant: 0 | 1 | 2; // 默认 0
  model: string; // 只读，来自后端环境变量
  daily_limit: number; // 只读
  daily_used: number; // 只读，今日已发送条数
}
```

| 方法  | 路径            | 请求体                                                                                              | 成功           |
| ----- | --------------- | --------------------------------------------------------------------------------------------------- | -------------- |
| GET   | `/api/settings` | —                                                                                                   | `200 Settings` |
| PATCH | `/api/settings` | `Settings` 中 `temperature`、`max_tokens`、`world_setting`、`my_gender`、`strip_variant` 的任意子集 | `200 Settings` |

- `world_setting` 传空字符串表示恢复默认

## 5. 角色提示词 `/api/prompts`

```ts
interface CharacterPrompt {
  character_name: string;
  prompt: string; // 生效文本：覆盖值或内置值
  is_custom: boolean; // 是否存在用户覆盖
}
```

| 方法 | 路径                            | 请求体     | 成功                                                             |
| ---- | ------------------------------- | ---------- | ---------------------------------------------------------------- |
| GET  | `/api/prompts`                  | —          | `200 CharacterPrompt[]`（29 条，按内置顺序）                     |
| PUT  | `/api/prompts/{character_name}` | `{prompt}` | `200 CharacterPrompt`；`prompt` 为空或与内置值相同时删除覆盖记录 |

- "与内置值相同"在两边都去掉首尾空白后比较：只比内置值多了末尾空格或换行不算自定义，同样删除覆盖

## 6. AI 连接测试与统计

| 方法 | 路径                                 | 成功                                                                                                                    |
| ---- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/ai/ping`                       | `200 {ok: true, model}` 或 `200 {ok: false, model, error: "<中文原因>"}`；后端向上游发一次 `max_tokens: 1` 的非流式请求 |
| GET  | `/api/data/stats`                    | `200 {characters: 29, conversations_with_content, messages}`                                                            |
| POST | `/api/data/delete-all-conversations` | `204`：每个角色只保留一个新的空会话                                                                                     |
| POST | `/api/data/clear-all-messages`       | `204`                                                                                                                   |
| POST | `/api/data/clear-all-context`        | `204`                                                                                                                   |
| GET  | `/health`                            | `200 {status: "ok"}`                                                                                                    |

## 7. 后端环境变量（`backend/.env.example`）

`.env` 固定按 `backend/.env` 的绝对路径读取，与启动目录无关；环境变量优先于 `.env`。

| 变量                              | 默认                        | 说明                                    |
| --------------------------------- | --------------------------- | --------------------------------------- |
| `DEEPSEEK_API_KEY`                | —                           | 只在后端使用                            |
| `DEEPSEEK_BASE_URL`               | `https://api.deepseek.com`  |                                         |
| `DEEPSEEK_MODEL`                  | `deepseek-flash`            | 2026-09 官方模型 ID（V4.1 Flash）       |
| `DATABASE_URL`                    | `sqlite:///./data/baker.db` | 线上填 Neon 的 `postgresql+psycopg://…` |
| `JWT_SECRET`                      | —                           | 必填                                    |
| `CORS_ORIGINS`                    | `http://localhost:5173`     | 逗号分隔                                |
| `DAILY_MESSAGE_LIMIT`             | `100`                       |                                         |
| `DEMO_USERNAME` / `DEMO_PASSWORD` | `demo` / `demo123`          | 启动时不存在则创建                      |
| `AI_MOCK`                         | `0`                         | `1` 时不调用上游                        |

## 8. 前端环境变量（`frontend/.env.example`）

| 变量                | 默认                    | 说明                    |
| ------------------- | ----------------------- | ----------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | 后端根地址，不含 `/api` |
