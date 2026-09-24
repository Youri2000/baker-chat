"""SQLAlchemy 模型：用户、设置、提示词覆盖、会话、可见消息与 AI 上下文（spec §3）。"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, TypeDecorator, UniqueConstraint
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# 💡 让 SQLite 像 Postgres 一样不复用已删除的 id，详见 docs/interview.md#sqlite-postgres
NO_ID_REUSE = {"sqlite_autoincrement": True}


class UtcDateTime(TypeDecorator[datetime]):
    """带时区的时间列：SQLite 读回的是 naive 值，补上 UTC 以保证响应里的 ISO 字符串带时区。"""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """读库时为 naive 时间补上 UTC；Postgres 返回的已带时区，原样返回。"""
        if value is None or value.tzinfo is not None:
            return value
        return value.replace(tzinfo=UTC)


def utcnow() -> datetime:
    """当前 UTC 时间，作为各表 created_at / updated_at 的默认值。"""
    return datetime.now(UTC)


class User(Base):
    """注册用户；密码只保存 bcrypt 哈希。"""

    __tablename__ = "users"
    __table_args__ = NO_ID_REUSE

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class UserSettings(Base):
    """与用户一对一的个性化设置；world_setting 为空表示使用默认世界观。"""

    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    temperature: Mapped[float] = mapped_column(default=0.8)
    max_tokens: Mapped[int] = mapped_column(default=2048)
    world_setting: Mapped[str] = mapped_column(Text, default="")
    my_gender: Mapped[str] = mapped_column(String(10), default="male")
    strip_variant: Mapped[int] = mapped_column(default=0)


class PromptOverride(Base):
    """用户对某个角色内置提示词的覆盖；不存在记录即使用内置值。"""

    __tablename__ = "prompt_overrides"
    __table_args__ = (UniqueConstraint("user_id", "character_name"), NO_ID_REUSE)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    character_name: Mapped[str] = mapped_column(String(20))
    prompt: Mapped[str] = mapped_column(Text)


class Conversation(Base):
    """某个用户与某个角色的一段会话；每个角色至少保留一段。"""

    __tablename__ = "conversations"
    __table_args__ = NO_ID_REUSE

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    character_name: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class Message(Base):
    """界面上可见的一条消息；AI 回复按行拆成多条 other 消息。"""

    __tablename__ = "messages"
    __table_args__ = NO_ID_REUSE

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    side: Mapped[str] = mapped_column(String(5))  # mine / other
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10))  # completed / aborted / failed
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class ContextEntry(Base):
    """发给 AI 的记忆条目，与可见消息分开存储，清空消息不影响它。

    💡 与 Message 分表且只按条数截断（chat.py 取最近 40 条，不引入 tokenizer），
    详见 docs/interview.md#context-window
    """

    __tablename__ = "context_entries"
    __table_args__ = NO_ID_REUSE

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(10))  # user / assistant
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
