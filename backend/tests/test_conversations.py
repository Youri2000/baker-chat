"""会话与消息接口测试：排序、新建、删除 409、跨用户 404、清空消息与清空上下文互不影响。"""

from fastapi.testclient import TestClient

from app.characters import CHARACTER_NAMES
from tests.conftest import context_rows, first_conversation, message_rows, register, seed


def test_list_sorted_by_character_order_then_created_at(
    client: TestClient, auth: dict[str, str]
) -> None:
    """新建的第二段洛茜会话排在第一段之后，整体仍按角色内置顺序。"""
    created = client.post("/api/conversations", json={"character_name": "洛茜"}, headers=auth)
    assert created.status_code == 201
    assert created.json()["character_name"] == "洛茜"

    conversations = client.get("/api/conversations", headers=auth).json()
    names = [c["character_name"] for c in conversations]
    assert names == CHARACTER_NAMES[:6] + ["洛茜"] + CHARACTER_NAMES[6:]
    luoxi = [c for c in conversations if c["character_name"] == "洛茜"]
    assert luoxi[1]["id"] == created.json()["id"]


def test_create_unknown_character_422(client: TestClient, auth: dict[str, str]) -> None:
    """不存在的角色名返回 422。"""
    response = client.post("/api/conversations", json={"character_name": "路人"}, headers=auth)
    assert response.status_code == 422


def test_delete_last_conversation_409(client: TestClient, auth: dict[str, str]) -> None:
    """某角色只剩一段会话时不能删。"""
    response = client.delete(f"/api/conversations/{first_conversation(client, auth)}", headers=auth)
    assert response.status_code == 409
    assert response.json()["detail"] == "该角色至少保留一个会话"


def test_delete_extra_conversation_204(client: TestClient, auth: dict[str, str]) -> None:
    """有两段会话时可以删掉一段，连同它的消息与上下文；再删返回 404。"""
    extra = client.post("/api/conversations", json={"character_name": "梨诺"}, headers=auth).json()
    seed(extra["id"], messages=[("mine", "hi")], context=[("user", "hi")])

    assert client.delete(f"/api/conversations/{extra['id']}", headers=auth).status_code == 204
    assert len(client.get("/api/conversations", headers=auth).json()) == 29
    assert message_rows(extra["id"]) == [] and context_rows(extra["id"]) == []
    assert client.delete(f"/api/conversations/{extra['id']}", headers=auth).status_code == 404


def test_cross_user_access_404(client: TestClient, auth: dict[str, str]) -> None:
    """用 bob 的 token 访问 alice 的会话，所有接口都返回 404。"""
    bob = register(client, "bob")
    alice_conversation = first_conversation(client, auth)
    base = f"/api/conversations/{alice_conversation}"
    assert client.get(f"{base}/messages", headers=bob).status_code == 404
    assert client.delete(base, headers=bob).status_code == 404
    assert client.post(f"{base}/messages/clear", headers=bob).status_code == 404
    assert client.post(f"{base}/context/clear", headers=bob).status_code == 404
    assert client.post(f"{base}/chat", json={"text": "hi"}, headers=bob).status_code == 404


def test_messages_listed_by_id_with_preview(client: TestClient, auth: dict[str, str]) -> None:
    """消息按 id 升序返回，会话列表的 last_message 是最后一条。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "你好"), ("other", "管理员好[sns_emoji_001]")])

    messages = client.get(f"/api/conversations/{conversation_id}/messages", headers=auth).json()
    assert [(m["side"], m["text"], m["status"]) for m in messages] == [
        ("mine", "你好", "completed"),
        ("other", "管理员好[sns_emoji_001]", "completed"),
    ]
    assert messages[0]["created_at"].endswith("Z") or "+00:00" in messages[0]["created_at"]

    conversations = client.get("/api/conversations", headers=auth).json()
    assert conversations[0]["last_message"] == {"side": "other", "text": "管理员好[sns_emoji_001]"}


def test_clear_messages_keeps_context(client: TestClient, auth: dict[str, str]) -> None:
    """清空消息后可见消息为空，AI 上下文原样保留。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "记住 42")], context=[("user", "记住 42")])

    response = client.post(f"/api/conversations/{conversation_id}/messages/clear", headers=auth)
    assert response.status_code == 204
    assert client.get(f"/api/conversations/{conversation_id}/messages", headers=auth).json() == []
    assert context_rows(conversation_id) == [("user", "记住 42")]


def test_clear_context_keeps_messages(client: TestClient, auth: dict[str, str]) -> None:
    """清空上下文后 AI 记忆为空，可见消息原样保留。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "记住 42")], context=[("user", "记住 42")])

    response = client.post(f"/api/conversations/{conversation_id}/context/clear", headers=auth)
    assert response.status_code == 204
    assert context_rows(conversation_id) == []
    assert message_rows(conversation_id) == [("mine", "记住 42", "completed")]
