"""应用入口：创建 FastAPI、配置 CORS、注册路由；启动时建表并种子演示账号。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models import User
from app.routers import auth, chat, conversations, data, prompts
from app.routers import settings as settings_router
from app.routers.auth import create_user


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """启动阶段：确保 SQLite 数据目录存在、建表、演示账号不存在则创建。"""
    if settings.database_url.startswith("sqlite:///"):
        Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(
            parents=True, exist_ok=True
        )
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == settings.demo_username)) is None:
            create_user(db, settings.demo_username, settings.demo_password)
    yield


app = FastAPI(title="Baker Chat API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
for router in (
    auth.router,
    conversations.router,
    chat.router,
    settings_router.router,
    prompts.router,
    data.router,
):
    app.include_router(router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    """存活探针，不需要登录。"""
    return {"status": "ok"}
