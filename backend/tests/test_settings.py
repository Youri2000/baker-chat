"""设置接口测试：默认值、部分更新、世界观恢复默认、范围校验、用户隔离。"""

import pytest
from fastapi.testclient import TestClient

from app.characters import DEFAULT_WORLD_SETTING
from tests.conftest import register


def test_defaults(client: TestClient, auth: dict[str, str]) -> None:
    """新用户的设置为默认值，世界观返回生效的默认文本。"""
    assert client.get("/api/settings", headers=auth).json() == {
        "temperature": 0.8,
        "max_tokens": 2048,
        "world_setting": DEFAULT_WORLD_SETTING,
        "world_setting_is_default": True,
        "my_gender": "male",
        "strip_variant": 0,
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
