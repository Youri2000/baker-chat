"""数据库连接：engine、SessionLocal、Base 与 get_db 依赖；DATABASE_URL 决定 SQLite 或 Postgres。"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的公共基类。"""


# ⚠️ SQLite 连接会跨线程使用（线程池里的路由 + 事件循环里的流式持久化），必须关闭同线程检查
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine)


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：为一次请求提供一个同步 Session，请求结束后自动关闭。"""
    with SessionLocal() as db:
        yield db
