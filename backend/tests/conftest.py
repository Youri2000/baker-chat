"""pytest 公共夹具与辅助函数：测试环境变量、共享内存 SQLite、TestClient、上游 mock 与造数。"""

import json
import os
from collections.abc import Iterator

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

# ⚠️ 必须先于 app 导入：config.py 在导入时就实例化 Settings 并要求 JWT_SECRET
os.environ.update(
    JWT_SECRET="test-secret-at-least-32-bytes-long!",
    DATABASE_URL="sqlite://",
    DEEPSEEK_API_KEY="test-key",
    DEEPSEEK_BASE_URL="https://upstream.test",
    DEEPSEEK_MODEL="deepseek-test",
    AI_MOCK="0",
    DAILY_MESSAGE_LIMIT="100",
    DEMO_USERNAME="demo",
    DEMO_PASSWORD="demo123",
)

from app.db import Base, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ContextEntry, Message  # noqa: E402

# ⚠️ 单连接 StaticPool：内存库只活在一个连接里，线程池里的路由和事件循环里的持久化必须共用它
test_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
SessionLocal.configure(bind=test_engine)


@pytest.fixture(autouse=True)
def fresh_db() -> Iterator[None]:
    """每个用例前重建全部表，用例之间互不影响。"""
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    yield


@pytest.fixture
def client() -> TestClient:
    """不触发 lifespan 的客户端；建表由 fresh_db 负责，种子逻辑单独测。"""
    return TestClient(app)


def register(client: TestClient, username: str) -> dict[str, str]:
    """注册一个用户并返回它的鉴权头。"""
    response = client.post(
        "/api/auth/register", json={"username": username, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    """默认用户 alice 的鉴权头。"""
    return register(client, "alice")


@pytest.fixture
def upstream() -> Iterator[respx.MockRouter]:
    """拦截发往 DeepSeek 的全部请求。"""
    with respx.mock(base_url="https://upstream.test", assert_all_called=False) as router:
        yield router


def sse_body(*deltas: str, usage: dict[str, int] | None = None) -> bytes:
    """按 OpenAI 兼容格式拼一段上游 SSE 响应体。"""
    frames = [
        json.dumps({"choices": [{"delta": {"content": d}}]}, ensure_ascii=False) for d in deltas
    ]
    if usage is not None:
        frames.append(json.dumps({"choices": [], "usage": usage}))
    frames.append("[DONE]")
    return "".join(f"data: {frame}\n\n" for frame in frames).encode()


def mock_upstream(
    upstream: respx.MockRouter, *deltas: str, usage: dict[str, int] | None = None
) -> respx.Route:
    """让上游按给定增量顺序回复，返回路由以便断言请求内容。"""
    return upstream.post("/chat/completions").mock(
        return_value=httpx.Response(
            200,
            content=sse_body(*deltas, usage=usage),
            headers={"content-type": "text/event-stream"},
        )
    )


def first_conversation(client: TestClient, auth: dict[str, str]) -> int:
    """列表里第一段会话（角色梨诺）的 id。"""
    return client.get("/api/conversations", headers=auth).json()[0]["id"]


def sse_events(
    client: TestClient, auth: dict[str, str], conversation_id: int, text: str
) -> list[dict[str, object] | str]:
    """发送一条消息并把收到的 SSE 帧解析为对象列表，[DONE] 保持为字符串。"""
    with client.stream(
        "POST", f"/api/conversations/{conversation_id}/chat", json={"text": text}, headers=auth
    ) as response:
        assert response.status_code == 200, response.text
        payloads = [line[5:].strip() for line in response.iter_lines() if line.startswith("data:")]
    return [payload if payload == "[DONE]" else json.loads(payload) for payload in payloads]


def seed(
    conversation_id: int,
    messages: list[tuple[str, str]] = (),
    context: list[tuple[str, str]] = (),
) -> None:
    """直接向库里写入可见消息 (side, text) 与上下文 (role, content)。"""
    with SessionLocal() as db:
        db.add_all(
            Message(conversation_id=conversation_id, side=side, text=text, status="completed")
            for side, text in messages
        )
        db.add_all(
            ContextEntry(conversation_id=conversation_id, role=role, content=content)
            for role, content in context
        )
        db.commit()


def context_rows(conversation_id: int) -> list[tuple[str, str]]:
    """读出某会话的上下文 (role, content)，按写入顺序。"""
    with SessionLocal() as db:
        entries = db.scalars(
            select(ContextEntry)
            .where(ContextEntry.conversation_id == conversation_id)
            .order_by(ContextEntry.id)
        )
        return [(entry.role, entry.content) for entry in entries]


def message_rows(conversation_id: int) -> list[tuple[str, str, str]]:
    """读出某会话的可见消息 (side, text, status)，按 id 顺序。"""
    with SessionLocal() as db:
        messages = db.scalars(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id)
        )
        return [(m.side, m.text, m.status) for m in messages]
