# 后端镜像：python:3.13-slim + 项目依赖，uvicorn 监听 0.0.0.0:8000；/app/data 存放 SQLite，可挂载卷持久化
FROM python:3.13-slim

WORKDIR /app

# 先复制元数据与源码，再一次性安装（依赖变化才会重新构建这一层）
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

VOLUME ["/app/data"]
EXPOSE 8000

# Render 通过 PORT 注入监听端口，本地 compose 不设则用 8000；exec 让 uvicorn 成为 PID 1 以正常接收停止信号
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
