# Baker Chat 后端架构

依据当前 `backend/app` 源码绘制。后端是 FastAPI 单体应用，业务逻辑主要位于路由函数中；图中分组表示职责，不代表独立部署服务。数据库由 `DATABASE_URL` 选择，默认 SQLite，也支持 PostgreSQL。

```mermaid
flowchart TB
    FE["React 前端"]

    subgraph BE["后端 · Uvicorn + FastAPI"]
        ENTRY["main.py · 应用入口<br/>CORS · /api 路由注册 · /health"]
        AUTH["auth.py · 注册 / 登录 / 当前用户<br/>security.py · bcrypt + JWT"]
        GUARD["deps.py · 受保护接口依赖<br/>JWT 校验 · 用户查询 · 会话归属校验"]
        CRUD["业务路由<br/>conversations.py · 会话与消息<br/>settings.py · 用户设置<br/>prompts.py · 角色提示词<br/>data.py · 统计与批量清理"]
        CHAT["chat.py · 对话编排<br/>每日额度 · 保存用户消息<br/>组装提示词 + 最近 40 条上下文"]
        STREAM["stream_reply · SSE 转发<br/>delta / usage / error<br/>结束时持久化，再发送 DONE"]
        STOP["停止控制<br/>active_streams 进程内登记表<br/>asyncio.Event · stop / finished"]
        AI["ai.py · 上游适配<br/>httpx.AsyncClient · 超时 / 错误映射<br/>AI_MOCK 可切换本地假流"]
        ORM["db.py + models.py<br/>SQLAlchemy · 同步 Session"]
        PROMPT["characters.py<br/>内置角色提示词 · 默认世界观<br/>固定系统提示词"]
    end

    DB[("SQLite / PostgreSQL<br/>users · user_settings · prompt_overrides<br/>conversations · messages · context_entries")]
    LLM["DeepSeek API<br/>POST /chat/completions"]

    FE -->|"HTTP / JSON；受保护请求携带 Bearer JWT"| ENTRY
    ENTRY --> AUTH
    ENTRY --> GUARD
    GUARD --> CRUD
    GUARD --> CHAT
    GUARD --> STOP
    GUARD -.->|"查询用户与会话"| ORM
    AUTH --> ORM
    CRUD --> ORM
    CHAT --> ORM
    PROMPT --> CHAT
    CHAT --> STREAM
    STREAM --> AI
    AI <-->|"请求 / 上游流"| LLM
    STOP -.->|"停止信号 / 等待落库完成"| STREAM
    STREAM -->|"persist_reply"| ORM
    STREAM -->|"SSE 响应"| FE
    ORM <--> DB
```

## 一次对话的时序

```mermaid
sequenceDiagram
    participant F as 前端
    participant R as chat.py / 依赖校验
    participant D as SQLAlchemy / 数据库
    participant S as stream_reply
    participant A as ai.py / DeepSeek

    F->>R: POST /api/conversations/{id}/chat
    R->>D: 校验用户、会话归属、当日额度
    R->>D: 保存用户 Message + ContextEntry
    R->>D: 读取用户设置、提示词覆盖、最近 40 条上下文
    R->>S: 创建 StreamingResponse
    S->>S: 登记 active_streams[id]
    S->>A: 两条 system + 最近上下文
    loop 接收上游增量
        A-->>S: delta / usage
        S-->>F: SSE data 帧
    end
    opt 用户主动停止
        F->>R: POST /api/conversations/{id}/chat/stop
        R->>S: 设置 stop 事件，等待 finished
        S->>A: 取消等待并关闭上游流
    end
    S->>D: finally 中 persist_reply，提交事务
    Note over S,D: 正常完成 / 停止 / 断连 / 上游错误均进入持久化清理路径
    S->>S: 移除活动流，设置 finished
    opt 存在等待中的停止请求
        R-->>F: stopped: true
    end
    S-->>F: data: [DONE]（连接仍在时）
    F->>R: GET /api/conversations/{id}/messages
    R->>D: 查询持久化消息
    R-->>F: JSON 消息列表
```

## 关键边界

- **鉴权**：注册、登录和健康检查公开；受保护接口通过 `UserDep` 校验 JWT，会话接口通过 `ConversationDep` 校验归属。`/auth/me` 也需要鉴权。
- **消息与记忆分离**：`messages` 保存界面可见消息，`context_entries` 保存发给 AI 的上下文；清空其中一类不会自动清空另一类。
- **流式持久化**：正常结束保存完整回复；停止或断连丢弃未完成的最后半行；上游错误保存已完成消息及错误提示，但不把失败回复追加为 assistant 上下文。
- **停止控制**：`active_streams` 是进程内状态。当前 Docker 启动命令没有配置多个 worker；若扩展为多进程或多实例，需要重新设计停止信号的跨进程协调。
- **启动与配置**：`config.py` 从环境变量及 `backend/.env` 读取设置；`main.py` 的 lifespan 建表、给旧表补上后来新增的列（`db.py` 的 `add_missing_columns`，目前是 `user_settings.typewriter`），并在演示账号不存在时初始化账号、设置和默认会话。
- **连接测试**：`GET /api/ai/ping` 经 `UserDep` 校验后调用 `ai.ping()`，发送最小非流式上游请求；为保持主图清晰，未单列该分支。

## 源码入口

- `backend/app/main.py`：应用入口、生命周期、路由注册。
- `backend/app/deps.py` 与 `backend/app/security.py`：权限依赖、JWT 与密码哈希。
- `backend/app/routers/chat.py`：额度、上下文组装、SSE、停止与回复持久化。
- `backend/app/ai.py`：DeepSeek 请求、模拟流、上游错误处理。
- `backend/app/db.py` 与 `backend/app/models.py`：连接、会话及六张业务表。
