"""设置接口测试：默认值、部分更新、世界观恢复默认、范围校验、用户隔离、打字机开关与旧库启动补列。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

import app.main
from app.characters import DEFAULT_WORLD_SETTING
from app.main import app as fastapi_app
from tests.conftest import register, test_engine


def test_defaults(client: TestClient, auth: dict[str, str]) -> None:
    """新用户的设置为默认值，世界观返回生效的默认文本。"""
    assert client.get("/api/settings", headers=auth).json() == {
        "temperature": 0.8,
        "max_tokens": 2048,
        "world_setting": DEFAULT_WORLD_SETTING,
        "world_setting_is_default": True,
        "my_gender": "male",
        "strip_variant": 0,
        "typewriter": True,
        "model": "deepseek-test",
        "daily_limit": 100,
        "daily_used": 0,
    }


def test_patch_partial_update_and_world_reset(client: TestClient, auth: dict[str, str]) -> None:
    """只更新传入字段；world_setting 传空串恢复默认。"""
    patched = client.patch(
        "/api/settings",
        json={"world_setting": "自定义世界", "my_gender": "female", "strip_variant": 2},
        headers=auth,
    ).json()
    assert patched["world_setting"] == "自定义世界"
    assert patched["world_setting_is_default"] is False
    assert (patched["my_gender"], patched["strip_variant"]) == ("female", 2)
    assert (patched["temperature"], patched["max_tokens"]) == (0.8, 2048)

    reset = client.patch("/api/settings", json={"world_setting": ""}, headers=auth).json()
    assert reset["world_setting"] == DEFAULT_WORLD_SETTING
    assert reset["world_setting_is_default"] is True
    assert reset["my_gender"] == "female"  # 其他字段不受影响


def test_patch_blank_world_setting_restores_default(
    client: TestClient, auth: dict[str, str]
) -> None:
    """纯空白的 world_setting 等同于空串：恢复默认，而不是把空白存起来发给 AI。"""
    client.patch("/api/settings", json={"world_setting": "自定义世界"}, headers=auth)
    blank = client.patch("/api/settings", json={"world_setting": " \n\t "}, headers=auth).json()
    assert blank["world_setting"] == DEFAULT_WORLD_SETTING
    assert blank["world_setting_is_default"] is True
    again = client.get("/api/settings", headers=auth).json()
    assert again["world_setting_is_default"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"temperature": 2.5},
        {"temperature": -0.1},
        {"max_tokens": 0},
        {"max_tokens": 8193},
        {"strip_variant": 3},
        {"my_gender": "other"},
        {"typewriter": "maybe"},
    ],
)
def test_patch_validation_422(
    client: TestClient, auth: dict[str, str], payload: dict[str, object]
) -> None:
    """超出范围的值返回 422，设置保持不变。"""
    assert client.patch("/api/settings", json=payload, headers=auth).status_code == 422
    assert client.get("/api/settings", headers=auth).json()["temperature"] == 0.8


def test_settings_isolated_between_users(client: TestClient, auth: dict[str, str]) -> None:
    """用户 alice 的修改不影响 bob。"""
    client.patch("/api/settings", json={"temperature": 1.5}, headers=auth)
    bob = register(client, "bob")
    assert client.get("/api/settings", headers=bob).json()["temperature"] == 0.8


def test_patch_typewriter(client: TestClient, auth: dict[str, str]) -> None:
    """打字机开关可以单独关闭与重新打开，其他设置不受影响；每个用户独立。"""
    off = client.patch("/api/settings", json={"typewriter": False}, headers=auth).json()
    assert off["typewriter"] is False
    assert (off["temperature"], off["max_tokens"]) == (0.8, 2048)
    assert client.get("/api/settings", headers=auth).json()["typewriter"] is False
    bob = register(client, "bob")
    assert client.get("/api/settings", headers=bob).json()["typewriter"] is True
    on = client.patch("/api/settings", json={"typewriter": True}, headers=auth).json()
    assert on["typewriter"] is True


def settings_columns() -> set[str]:
    """测试库 user_settings 表现有的列名。"""
    return {column["name"] for column in inspect(test_engine).get_columns("user_settings")}


def test_startup_adds_missing_typewriter_column(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """旧库启动时自动补列。

    user_settings 还没有 typewriter 列、已有用户设置时，启动后补上该列，已有用户默认开启，
    其他设置不变；重复启动不报错。
    """
    client.patch("/api/settings", json={"temperature": 1.5, "strip_variant": 2}, headers=auth)
    # 退回到加列之前的表结构（SQLite 3.35+ 支持 DROP COLUMN）
    with test_engine.begin() as connection:
        connection.execute(text("ALTER TABLE user_settings DROP COLUMN typewriter"))
    assert "typewriter" not in settings_columns()

    # 让 lifespan 作用在测试库上；启动两次验证补列只做一次
    monkeypatch.setattr(app.main, "engine", test_engine)
    for _ in range(2):
        with TestClient(fastapi_app):
            pass
    assert "typewriter" in settings_columns()

    restored = client.get("/api/settings", headers=auth).json()
    assert restored["typewriter"] is True
    assert (restored["temperature"], restored["strip_variant"]) == (1.5, 2)
    client.patch("/api/settings", json={"typewriter": False}, headers=auth)
    assert client.get("/api/settings", headers=auth).json()["typewriter"] is False
