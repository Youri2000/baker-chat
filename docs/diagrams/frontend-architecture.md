# Baker Chat 前端架构

依据当前 `frontend/src` 源码绘制（2026-09-29，含按需加载、消息分页、虚拟列表、两个 Hook 与打字机输出）。技术栈为 React 19、TypeScript、Vite、React Router、Zustand、Tailwind CSS 4 与 `@tanstack/react-virtual`。图表示运行时职责与主要调用关系，不是完整 import 依赖图。同目录的可交互 HTML 图（`*.html` / `*.json`）生成于这些改动之前，以本文为准。

## 整体架构

```mermaid
flowchart TB
    Entry["main.tsx → App<br/>启动登录校验 · 已登录时并行预取聊天页 · 挂载 React"]
    Router["React Router<br/>/login · /register · /"]

    subgraph UI["页面与组件"]
        AuthUI["LoginPage / RegisterPage"]
        Guard["RequireAuth<br/>无 token 跳转登录页"]
        Page["ChatPage · 按需加载（lazyWithPreload）"]
        Canvas["DesignCanvas · 1920 × 1080 等比缩放<br/>HeaderTop · CharacterCardList · ChatArea"]
        Tools["Toolbar · 画布外固定工具栏<br/>SettingsDialog（按需加载）· DeleteConfirmDialog"]
    end

    subgraph State["Zustand 状态与业务动作"]
        Auth["authStore<br/>token / user · 登录 / 退出"]
        Chat["chatStore<br/>会话 / 分页消息缓存（has_more）/ 选中与折叠<br/>发送 / 停止 / 流式临时气泡 / 加载更早历史"]
        Settings["settingsStore<br/>用户设置 / 提示词 / 统计<br/>乐观保存 / 数据清理"]
        Switch["userSwitch.ts<br/>用户切换重置登记表"]
    end

    subgraph Network["接口与通信"]
        API["features/*/api.ts<br/>auth · chat · settings"]
        HTTP["lib/http.ts<br/>fetch JSON · Bearer JWT · ApiError<br/>tokenStorage · 401 回调"]
        SSE["lib/sse.ts<br/>POST fetch · ReadableStream<br/>TextDecoder · SSE 帧解析"]
    end

    Local[("localStorage<br/>baker.token")]
    Backend["FastAPI 后端 /api"]

    Entry --> Router
    Entry -.->|"bootstrap"| Auth
    Router --> AuthUI
    Router --> Guard
    Guard --> Page
    Guard -.->|"订阅 token"| Auth
    Page --> Canvas
    Page --> Tools
    AuthUI <-->|"动作 / 订阅"| Auth
    Canvas <-->|"动作 / 订阅"| Chat
    Canvas <-->|"样式、头像与打字机开关"| Settings
    Tools <-->|"会话管理"| Chat
    Tools <-->|"设置与数据管理"| Settings
    Auth -->|"resetUserData"| Switch
    Chat -.->|"登记 reset"| Switch
    Settings -.->|"登记 reset"| Switch
    Auth --> API
    Chat --> API
    Settings --> API
    API --> HTTP
    Chat <-->|"发送 / 增量回调"| SSE
    SSE -.->|"复用请求头与状态校验"| HTTP
    HTTP <--> Local
    HTTP <-->|"HTTP / JSON"| Backend
    SSE <-->|"POST / SSE"| Backend
    HTTP -.->|"鉴权 401 回调"| Auth
```

实线表示主要调用或数据交互；双向线概括“动作与状态订阅”或“请求与响应”；虚线表示辅助依赖或回调。SSE 自己调用 fetch，不经过 JSON 请求函数 `http()`。

## 聊天页面组件树

```mermaid
flowchart TB
    Page["ChatPage"]
    Page --> Background["背景图片与遮罩"]
    Page --> Canvas["DesignCanvas"]
    Page --> Toolbar["Toolbar · 画布外"]
    Canvas --> Header["HeaderTop"]
    Canvas --> Cards["CharacterCardList"]
    Canvas --> Area["ChatArea"]
    Cards --> Card["CharacterCardItem"]
    Card --> Sub["SubCard · 会话预览"]
    Area --> Empty["ChatEmpty · 未选中会话"]
    Area --> Frame["ChatFrame · 聊天条与装饰"]
    Area --> List["MessageList · 虚拟列表 · role=log"]
    Area --> Input["ChatInput · 布局与接线"]
    List --> Scroll["useChatAutoScroll · 跟随 / 暂停 / 靠近顶部加载更早"]
    List --> Back["BackToBottomButton · 回到底部 / 有新消息"]
    List --> Row["ChatMessageRow · 头像（间距在虚拟行外层）"]
    Row --> Bubble["ChatBubble / LoadingBubble"]
    Input --> Composer["useChatComposer · 键盘 / 输入法 / 粘贴 / 表情 / 序列化"]
    Input --> Emoji["EmojiPop"]
    Toolbar --> Settings["SettingsDialog · 六个标签页"]
    Toolbar --> Delete["DeleteConfirmDialog"]
    Toolbar --> Hint["DialogShell · 选择角色提示"]
```

## 发送消息的数据流

```mermaid
sequenceDiagram
    participant I as ChatInput / useChatComposer
    participant C as chatStore
    participant S as lib/sse.ts
    participant B as 后端
    participant M as ChatArea / MessageList

    I->>I: submit：htmlToEmojiText 序列化文字与表情 token
    I->>C: onSend = sendMessage(text, 打字机开关)
    C->>C: 追加乐观用户消息，创建 streaming
    C-->>M: 状态订阅触发渲染
    C->>S: streamSse，传入 token 与 AbortSignal
    S->>B: POST /conversations/{id}/chat
    loop 流式回复
        B-->>S: data: delta
        S->>C: onDelta
        C->>C: createReplyDisplay 累积全文，按打字机节奏（每 16 ms 推进）或整行更新 bubbles
        C-->>M: 展示临时气泡与加载气泡
    end
    B-->>S: data: [DONE]，随后关闭流
    S->>C: onDone，剩余内容照常写完（打字机）或作为最后一个气泡（整行）
    S-->>C: streamSse 返回
    C->>C: 内容全部显示后 pending = false，保留临时气泡
    C->>B: 经 chat/api.ts + http.ts 重拉最新一页
    B-->>C: {items, has_more}
    C->>C: mergeLatest 与已加载的更早历史合并，一次更新消息缓存、会话预览并清除 streaming
    C-->>M: 持久化消息替换临时气泡
```

## 状态与渲染边界

- **共享状态**：三个业务 store 分别负责登录、聊天、设置；`toastStore` 驱动 App 根部的 `Toast`，主图省略其连线。
- **组件局部状态**：工具栏与弹窗开关、设置页草稿、表情面板状态由组件维护；输入内容保存在 contenteditable DOM 中。
- **跨 store 协作**：登录、注册、退出及鉴权过期时，`authStore` 调用 `userSwitch` 登记表的 `resetUserData`，执行聊天与设置 store 在模块加载时登记的 reset（`authStore` 不直接引用它们，两个 store 随聊天页按需加载）；设置页的批量数据清理也同步聊天缓存。这描述当前调用关系，不代表已解决所有异步竞态。
- **持久化**：前端 localStorage 只保存 token；会话、消息与用户设置通过后端持久化。
- **流式状态**：全局只有一个 `streaming`，以 `conversationId` 绑定目标会话；切换会话不会把回复改写到新会话，逐字进度照常推进。停止时界面先收成与落库一致的行，再请求后端 stop 接口，最后 abort 本地读取作为兜底。
- **消息渲染**：`MessageList` 合并已加载的消息与当前会话临时气泡；`chatRows.ts` 按完整列表计算间距和头像显隐，虚拟列表只渲染可视区附近的行；`ChatBubble` 使用 memo 与 ResizeObserver，按内容尺寸绘制 SVG 气泡；滚动规则在 `useChatAutoScroll`。
- **视觉资源**：`styles/index.css` 提供 Tailwind 主题令牌和字体；`constants/` 管理设计坐标、角色、表情与素材映射，`assets/` 存放本地图片和字体。
- **启动校验**：`main.tsx` 发起异步 bootstrap，有 token 时与它并行预取聊天页代码（最多等 200 ms）后挂载 App；路由守卫判断内存 token 是否存在，实际身份与会话访问权限由后端验证。

## 源码入口

- `frontend/src/main.tsx`、`frontend/src/App.tsx`：启动和路由。
- `frontend/src/features/auth/authStore.ts`、`userSwitch.ts`：登录态及用户切换时的重置登记表。
- `frontend/src/components/lazyWithPreload.tsx`、`frontend/src/features/chat/loadChatPage.ts`：可预取的按需加载。
- `frontend/src/features/chat/useChatAutoScroll.ts`、`useChatComposer.ts`：滚动规则与输入框编辑行为。
- `frontend/src/features/chat/ChatPage.tsx`：页面组件组合。
- `frontend/src/features/chat/chatStore.ts`：会话、消息和 SSE 业务编排，含回复的显示驱动 `createReplyDisplay`。
- `frontend/src/features/chat/typewriter.ts`：打字机节奏的纯函数（分行、逐字推进、可见内容）。
- `frontend/src/features/settings/settingsStore.ts`：设置和数据管理。
- `frontend/src/lib/http.ts`、`frontend/src/lib/sse.ts`：两条通信路径。
