"""鉴权接口测试：注册校验与 409、登录 401、me、演示账号种子、JWT_SECRET 必填。"""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import app
from tests.conftest import register


def test_register_returns_token_and_seeds_user_data(client: TestClient) -> None:
    """注册成功返回 201、token 与用户；同时建好 29 个空会话与默认设置。"""
    response = client.post(
        "/api/auth/register", json={"username": "alice", "password": "secret123"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["user"] == {"id": body["user"]["id"], "username": "alice"}
    headers = {"Authorization": f"Bearer {body['token']}"}

    conversations = client.get("/api/conversations", headers=headers).json()
    assert len(conversations) == 29
    assert all(c["last_message"] is None for c in conversations)
    settings = client.get("/api/settings", headers=headers).json()
    assert (settings["temperature"], settings["max_tokens"]) == (0.8, 2048)


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "ab", "password": "secret123"},  # 用户名过短
        {"username": "a-b-c", "password": "secret123"},  # 含非法字符
        {"username": "a" * 21, "password": "secret123"},  # 用户名过长
        {"username": "alice", "password": "12345"},  # 密码过短
        {"username": "alice", "password": "x" * 65},  # 密码过长
        {"username": "alice", "password": "pass word"},  # 含空格
        {"username": "alice", "password": "密码密码密码"},  # 非 ASCII
    ],
)
def test_register_validation_422(client: TestClient, payload: dict[str, str]) -> None:
    """不合规的用户名或密码返回 422。"""
    assert client.post("/api/auth/register", json=payload).status_code == 422


def test_password_accepts_printable_ascii_bounds(client: TestClient) -> None:
    """密码规则的边界：6 位与 64 位、含全部可打印 ASCII 符号的口令都能注册并登录。"""
    symbols = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    longest = ((symbols + "Az09") * 2)[:64]
    for username, password in (("bob", "abc123"), ("carol", longest)):
        assert len(password) in (6, 64)
        response = client.post(
            "/api/auth/register", json={"username": username, "password": password}
        )
        assert response.status_code == 201, response.text
        login = client.post("/api/auth/login", json={"username": username, "password": password})
        assert login.status_code == 200


def test_register_duplicate_409(client: TestClient) -> None:
    """重复用户名返回 409 与中文原因。"""
    register(client, "alice")
    response = client.post("/api/auth/register", json={"username": "alice", "password": "another1"})
    assert response.status_code == 409
    assert response.json()["detail"] == "用户名已被占用"


def test_login_success_and_failure(client: TestClient) -> None:
    """正确密码返回 token；密码错误或用户不存在都返回同一个 401。"""
    register(client, "alice")
    ok = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
    assert ok.status_code == 200
    assert ok.json()["user"]["username"] == "alice"

    for payload in (
        {"username": "alice", "password": "wrong-pw"},
        {"username": "nobody", "password": "secret123"},
    ):
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 401
        assert response.json()["detail"] == "用户名或密码错误"


def test_me_requires_valid_token(client: TestClient, auth: dict[str, str]) -> None:
    """有效 token 返回用户；缺失、伪造、过期 token 一律 401。"""
    assert client.get("/api/auth/me", headers=auth).json()["username"] == "alice"

    expired = jwt.encode(
        {"sub": "1", "exp": datetime.now(UTC) - timedelta(minutes=1)},
        "test-secret-at-least-32-bytes-long!",
        "HS256",
    )
    for headers in (
        {},
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": f"Bearer {expired}"},
        {"Authorization": "Basic abc"},
    ):
        response = client.get("/api/auth/me", headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"] == "未登录或登录已过期"


def test_demo_account_seeded_on_startup() -> None:
    """启动时 lifespan 会创建演示账号，重复启动不会重复创建。"""
    for _ in range(2):
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/login", json={"username": "demo", "password": "demo123"}
            )
            assert response.status_code == 200
            headers = {"Authorization": f"Bearer {response.json()['token']}"}
            assert len(client.get("/api/conversations", headers=headers).json()) == 29


def test_jwt_secret_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    """缺少 JWT_SECRET 时配置校验失败，应用无法启动。"""
    monkeypatch.delenv("JWT_SECRET")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_health_is_public(client: TestClient) -> None:
    """/health 不需要登录。"""
    assert client.get("/health").json() == {"status": "ok"}
