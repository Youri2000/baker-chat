"""数据库连接：engine、SessionLocal、Base、get_db 依赖与启动补列。

DATABASE_URL 决定 SQLite 或 Postgres。
"""

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的公共基类。"""


# ⚠️ SQLite 连接会跨线程使用（线程池里的路由 + 事件循环里的流式持久化），必须关闭同线程检查
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine)


def add_missing_columns(bind: Engine) -> None:
    """给已存在的旧表补上后来新增的列；create_all 只建缺失的表，不改已有表的结构。

    目前只有 user_settings.typewriter：线上 Neon 的表建于该字段之前，缺列时补上，
    已有用户取默认值开启。SQLite（3.23+ 支持 TRUE 关键字）与 Postgres 都接受这条 DDL；
    列已存在时什么也不做，重复启动安全。
    """
    inspector = inspect(bind)
    if "user_settings" not in inspector.get_table_names():
        return
    if "typewriter" in {column["name"] for column in inspector.get_columns("user_settings")}:
        return
    with bind.begin() as connection:
        connection.execute(
            text("ALTER TABLE user_settings ADD COLUMN typewriter BOOLEAN NOT NULL DEFAULT TRUE")
        )


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：为一次请求提供一个同步 Session，请求结束后自动关闭。"""
    with SessionLocal() as db:
        yield db
