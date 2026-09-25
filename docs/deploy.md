# 线上部署：Neon + Render + Vercel

三段式：浏览器 → **Vercel**（静态前端）→ **Render**（FastAPI，Docker）→ **Neon**（Postgres）与 DeepSeek。配置文件已在仓库里：`render.yaml`（Render Blueprint）、`frontend/vercel.json`（SPA 回退）、`backend/Dockerfile`（读 Render 注入的 `PORT`）。下面每一步写明在哪个页面点什么、填什么；账号注册与控制台操作由你完成，出问题按最后一节排查。

准备：

- GitHub 仓库 `Youri2000/baker-chat` 的 `main` 已推送，且 Actions 最近一次运行通过。
- 三个账号：[neon.tech](https://neon.tech)、[render.com](https://render.com)、[vercel.com](https://vercel.com)，都支持 "Continue with GitHub"。
- 两个密钥：DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) → API keys → Create）；JWT 密钥用终端 `openssl rand -hex 32` 生成（64 个十六进制字符，满足 HS256 ≥ 32 字节）。

## (a) Neon：建库并拿到连接串

1. 登录 [console.neon.tech](https://console.neon.tech) → **New Project**：Project name `baker-chat`，Postgres version 默认，Region 选 **Singapore (ap-southeast-1)**（与下面 Render 的 region 相同，减少跨区延迟）→ **Create project**。
2. 项目页顶部 **Connect** 按钮（旧版控制台是 Dashboard 的 Connection Details 卡片）→ Database 选 `neondb`、Role 选 `neondb_owner`、开启 **Pooled connection** → 复制连接串，形如：

   ```text
   postgresql://neondb_owner:npg_XXXX@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

3. 改成后端需要的形式：**只把开头 `postgresql://` 换成 `postgresql+psycopg://`**，其余原样保留（含 `?sslmode=require`；若控制台还给了 `&channel_binding=require`，psycopg 3 支持，留着也行）：

   ```text
   postgresql+psycopg://neondb_owner:npg_XXXX@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   这就是 Render 里的 `DATABASE_URL`。表不用手工建：后端启动时 `Base.metadata.create_all` 自动建表并种子演示账号。

## (b) Render：部署后端（Docker）

### 方式一：Blueprint（推荐，读仓库里的 render.yaml）

1. [dashboard.render.com](https://dashboard.render.com) → 右上 **New +** → **Blueprint** → **Connect** GitHub 账号并选择仓库 `Youri2000/baker-chat`（首次要在 GitHub 授权页勾选该仓库）。
2. Render 读取根目录 `render.yaml`，页面列出服务 `baker-chat-api`；Blueprint name 随意填 → 点 **Apply**。
3. 因为三项标记为 `sync: false`，Render 会弹出表单让你逐项填写：
   - `DEEPSEEK_API_KEY`：DeepSeek 平台的 Key（`sk-` 开头）。
   - `JWT_SECRET`：`openssl rand -hex 32` 的输出。
   - `DATABASE_URL`：第 (a) 步的 `postgresql+psycopg://…` 连接串。
4. 等待第一次构建（Docker 构建 + 启动约 2–4 分钟；Logs 页出现 `Uvicorn running on http://0.0.0.0:10000` 即启动成功，`10000` 是 Render 注入的 `PORT`）。
5. 服务页左上角显示域名，形如 `https://baker-chat-api.onrender.com`（名字被占用时 Render 会加随机后缀，以页面为准）。浏览器打开 `https://<域名>/health` 看到 `{"status":"ok"}`。

### 方式二：手动新建（不用 Blueprint）

**New +** → **Web Service** → 选仓库 → 填：

| 字段              | 值                                       |
| ----------------- | ---------------------------------------- |
| Name              | `baker-chat-api`                         |
| Region            | Singapore                                |
| Branch            | `main`                                   |
| Root Directory    | `backend`                                |
| Language          | Docker（Render 会自动找到 `Dockerfile`） |
| Instance Type     | Free                                     |
| Health Check Path | `/health`（在 Advanced 里）              |

Environment Variables 逐项 **Add**：

| Key                   | 值                                              |
| --------------------- | ----------------------------------------------- |
| `DEEPSEEK_API_KEY`    | 你的 Key                                        |
| `JWT_SECRET`          | `openssl rand -hex 32` 的输出                   |
| `DATABASE_URL`        | `postgresql+psycopg://…`（第 (a) 步）           |
| `DEEPSEEK_BASE_URL`   | `https://api.deepseek.com`                      |
| `DEEPSEEK_MODEL`      | `deepseek-flash`                                |
| `CORS_ORIGINS`        | 先随便填 `http://localhost:5173`，第 (d) 步再改 |
| `DAILY_MESSAGE_LIMIT` | `100`                                           |
| `DEMO_USERNAME`       | `demo`                                          |
| `DEMO_PASSWORD`       | `demo123`                                       |
| `AI_MOCK`             | `0`                                             |

点 **Create Web Service**，其余同方式一第 4–5 步。

## (c) Vercel：部署前端

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → 找到 `Youri2000/baker-chat` 点 **Import**（首次要安装 Vercel 的 GitHub App 并授权该仓库）。
2. **Configure Project** 页：
   - Framework Preset：自动识别为 **Vite**（`frontend/vercel.json` 里也写死了 `"framework": "vite"`）。
   - **Root Directory**：点 **Edit** → 选 `frontend` → 确认。这一步不能漏，否则 Vercel 在仓库根找不到 Vite。
   - Build and Output Settings 保持默认（Build Command `pnpm run build`，即 `tsc -b && vite build`；Output Directory `dist`）。Vercel 读到根目录的 `pnpm-lock.yaml` 与 `packageManager` 字段，会用 pnpm 9 在仓库根安装 workspace 依赖。
   - **Environment Variables**：Key `VITE_API_BASE_URL`，Value 填第 (b) 步的 Render 域名，**不带尾部斜杠、不含 `/api`**，例如 `https://baker-chat-api.onrender.com`；Environments 是单选下拉框，保持默认的 **Production and Preview** 即可（Development 只影响本地 `vercel dev`，用不到）。
3. 点 **Deploy**，约 1 分钟后拿到域名，形如 `https://baker-chat-xxxx.vercel.app`（项目 Settings → Domains 可看到全部域名，Production 域名通常是 `https://<project>.vercel.app`）。
4. `VITE_` 变量是**构建期**写进产物的：以后改了 `VITE_API_BASE_URL` 必须到 Deployments 页对最新部署点 **Redeploy**，改环境变量本身不会生效。

## (d) 回到 Render 改 CORS 白名单

1. Render 服务页 → 左侧 **Environment** → 找到 `CORS_ORIGINS` → 改为第 (c) 步的 Vercel Production 域名，例如 `https://baker-chat-xxxx.vercel.app`（协议 + 域名，无尾斜杠）。要同时允许 Preview 部署，用英文逗号分隔多个来源。
2. **Save Changes** → Render 自动重启服务（约 30 秒），Logs 出现新的 `Application startup complete.`。

## (e) 线上验收清单

按顺序做，任一步失败看下一节：

1. 打开 Vercel 地址 → 自动跳到 `/login`，页面显示"演示账号 demo / demo123"。
2. 点 **一键填入** → **登录** → 进入 `/`，左侧出现 29 张角色主卡（第一次点登录可能等 30–60 秒，见"冷启动"）。
3. 点"陈千语"主卡展开 → 点子卡 → 在输入框输入"你好"回车 → 先出现加载气泡，然后真实 DeepSeek 回复按行逐条出现。
4. 刷新页面 → 重新展开陈千语 → 子卡预览是刚才回复的最后一行，会话里消息仍在（数据在 Neon）。
5. 右上角 **设置** → **AI 配置** → **连接测试** → 显示"连接成功"，模型名 `deepseek-flash`。
6. Render 的 Logs 页能看到 `POST /api/conversations/<id>/chat HTTP/1.1" 200`。
7. 浏览器 DevTools → Network 里任何请求的 URL 与响应体都不含 DeepSeek Key。

## 常见失败与排查

**CORS 报错**（Console 出现 `No 'Access-Control-Allow-Origin' header is present`，Network 里请求状态 `CORS error` 或 `net::ERR_FAILED`）

- 先看 Render Logs 该请求返回的是不是 500：后端未捕获异常的 500 响应在 CORS 中间件之外，没有 ACAO 头，浏览器也会报成 CORS。是 500 就修后端，不是 CORS 的问题。
- 真 CORS：`CORS_ORIGINS` 里的来源必须与地址栏的**协议 + 域名**逐字一致（`https://`、无尾斜杠、无路径）；Preview 域名与 Production 域名不同，要分别加。改完等 Render 重启完成。
- 用终端确认白名单是否生效（把两处域名换成你的）：

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
    -H 'Origin: https://baker-chat-xxxx.vercel.app' \
    -H 'Access-Control-Request-Method: POST' \
    https://baker-chat-api.onrender.com/api/auth/login
  ```

  白名单包含该 Origin 时返回 `200`，否则 `400`。

**冷启动 / 首次很慢**

- Render Free 实例 15 分钟无流量就休眠，下一个请求要等 30–60 秒唤醒；此时登录页点"登录"可能提示"网络错误，请稍后重试"，等半分钟再点一次即可。演示前先在浏览器打开 `/health` 唤醒。
- Neon 免费计算实例 5 分钟无查询会挂起，唤醒时第一条查询多花约 1 秒，属正常。

**连接串格式**（Render Logs 里启动即崩）

- `ModuleNotFoundError: No module named 'psycopg2'`：连接串还是 `postgresql://` 开头，SQLAlchemy 默认找 psycopg2；改成 `postgresql+psycopg://`（后端只装了 psycopg 3）。
- `connection is insecure (try using sslmode=require)` 或 `SSL required`：连接串丢了 `?sslmode=require`。
- `password authentication failed`：从 Neon 重新 **Reset password** 复制完整串；密码含 `@`、`/`、`#` 等字符时要做 URL 编码。
- `pydantic_core._pydantic_core.ValidationError … jwt_secret Field required`：`JWT_SECRET` 没填。日志出现 `InsecureKeyLengthWarning` 说明密钥短于 32 字节，换 `openssl rand -hex 32`。

**Vercel 构建失败**

- 日志 `vite: command not found` / `No Output Directory named "dist"`：Root Directory 没设成 `frontend`。项目 Settings → General → Root Directory 改后 Redeploy。
- 日志 `ERR_PNPM_OUTDATED_LOCKFILE`：本地改了依赖没提交新的 `pnpm-lock.yaml`，本地 `pnpm install` 后提交锁文件。
- 页面能打开但刷新 `/login` 变 404：`frontend/vercel.json` 的 rewrites 没生效，确认 Root Directory 是 `frontend`（Vercel 只读 Root Directory 下的 `vercel.json`）。

**登录 / 对话相关**

- 演示账号登录 401 "用户名或密码错误"：Render 的 `DEMO_USERNAME` / `DEMO_PASSWORD` 被改过，或数据库换过（演示账号只在启动时"不存在则创建"）。
- 发消息后气泡显示 `[错误: 上游认证失败（401）]`：`DEEPSEEK_API_KEY` 错误或已删除；`（402）`/"上游请求失败"提示余额不足去 DeepSeek 平台充值；`上游限流` 稍后重试。
- 发消息提示"今日额度已用完"：该账号当天（UTC+8）已发 `DAILY_MESSAGE_LIMIT` 条，改环境变量或换账号。
- 页面请求打到 `undefined/api/...`：Vercel 没设置 `VITE_API_BASE_URL` 或设置后没有 Redeploy。
