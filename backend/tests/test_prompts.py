"""角色提示词接口测试：29 条内置、覆盖与删除覆盖、未知角色 404、用户隔离。"""

from fastapi.testclient import TestClient

from app.characters import CHARACTER_NAMES, CHARACTER_PROMPTS
from tests.conftest import register


def test_list_builtin_prompts_in_order(client: TestClient, auth: dict[str, str]) -> None:
    """新用户拿到 29 条内置提示词，顺序与内置顺序一致。"""
    prompts = client.get("/api/prompts", headers=auth).json()
    assert [p["character_name"] for p in prompts] == CHARACTER_NAMES
    assert all(not p["is_custom"] for p in prompts)
    assert all(p["prompt"] == CHARACTER_PROMPTS[p["character_name"]] for p in prompts)


def test_put_override_then_reset_by_builtin_value(client: TestClient, auth: dict[str, str]) -> None:
    """保存自定义值后 is_custom 为真；再保存与内置相同的值即删除覆盖。"""
    saved = client.put("/api/prompts/陈千语", json={"prompt": "自定义"}, headers=auth).json()
    assert saved == {"character_name": "陈千语", "prompt": "自定义", "is_custom": True}
    listed = {p["character_name"]: p for p in client.get("/api/prompts", headers=auth).json()}
    assert listed["陈千语"]["is_custom"] is True and listed["陈千语"]["prompt"] == "自定义"
    assert listed["梨诺"]["is_custom"] is False

    reset = client.put(
        "/api/prompts/陈千语", json={"prompt": CHARACTER_PROMPTS["陈千语"]}, headers=auth
    ).json()
    assert reset["is_custom"] is False
    listed = {p["character_name"]: p for p in client.get("/api/prompts", headers=auth).json()}
    assert listed["陈千语"]["is_custom"] is False


def test_put_empty_deletes_override(client: TestClient, auth: dict[str, str]) -> None:
    """保存空白内容即恢复默认，返回内置提示词。"""
    client.put("/api/prompts/陈千语", json={"prompt": "自定义"}, headers=auth)
    reset = client.put("/api/prompts/陈千语", json={"prompt": "  \n"}, headers=auth).json()
    assert reset == {
        "character_name": "陈千语",
        "prompt": CHARACTER_PROMPTS["陈千语"],
        "is_custom": False,
    }


def test_put_unknown_character_404(client: TestClient, auth: dict[str, str]) -> None:
    """不存在的角色返回 404。"""
    assert client.put("/api/prompts/路人", json={"prompt": "x"}, headers=auth).status_code == 404


def test_override_isolated_between_users(client: TestClient, auth: dict[str, str]) -> None:
    """用户 alice 的覆盖对 bob 不可见。"""
    client.put("/api/prompts/陈千语", json={"prompt": "自定义"}, headers=auth)
    bob = register(client, "bob")
    listed = {p["character_name"]: p for p in client.get("/api/prompts", headers=bob).json()}
    assert listed["陈千语"]["is_custom"] is False
