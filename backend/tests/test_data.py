"""数据管理接口测试：统计、删除全部对话、清空全部消息 / 上下文，以及只作用于当前用户。"""

from collections import Counter

from fastapi.testclient import TestClient

from app.characters import CHARACTER_NAMES
from tests.conftest import context_rows, first_conversation, message_rows, register, seed


def test_stats(client: TestClient, auth: dict[str, str]) -> None:
    """角色固定 29；对话数只算有消息的会话；消息数为全部可见消息。"""
    assert client.get("/api/data/stats", headers=auth).json() == {
        "characters": 29,
        "conversations_with_content": 0,
        "messages": 0,
    }
    conversations = client.get("/api/conversations", headers=auth).json()
    seed(conversations[0]["id"], messages=[("mine", "a"), ("other", "b")])
    seed(conversations[1]["id"], messages=[("mine", "c")])
    assert client.get("/api/data/stats", headers=auth).json() == {
        "characters": 29,
        "conversations_with_content": 2,
        "messages": 3,
    }


def test_delete_all_conversations_leaves_one_empty_per_character(
    client: TestClient, auth: dict[str, str]
) -> None:
    """删除全部对话后每个角色只剩一段新的空会话，消息与上下文都清零。"""
    old_id = first_conversation(client, auth)
    client.post("/api/conversations", json={"character_name": "梨诺"}, headers=auth)
    seed(old_id, messages=[("mine", "a")], context=[("user", "a")])

    assert client.post("/api/data/delete-all-conversations", headers=auth).status_code == 204
    conversations = client.get("/api/conversations", headers=auth).json()
    assert Counter(c["character_name"] for c in conversations) == Counter(CHARACTER_NAMES)
    assert all(c["last_message"] is None for c in conversations)
    assert old_id not in {c["id"] for c in conversations}
    assert message_rows(old_id) == [] and context_rows(old_id) == []
    stats = client.get("/api/data/stats", headers=auth).json()
    assert (stats["conversations_with_content"], stats["messages"]) == (0, 0)


def test_clear_all_messages_keeps_context(client: TestClient, auth: dict[str, str]) -> None:
    """清空全部消息后上下文仍在。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "a")], context=[("user", "a")])

    assert client.post("/api/data/clear-all-messages", headers=auth).status_code == 204
    assert message_rows(conversation_id) == []
    assert context_rows(conversation_id) == [("user", "a")]


def test_clear_all_context_keeps_messages(client: TestClient, auth: dict[str, str]) -> None:
    """清空全部上下文后可见消息仍在。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "a")], context=[("user", "a")])

    assert client.post("/api/data/clear-all-context", headers=auth).status_code == 204
    assert context_rows(conversation_id) == []
    assert message_rows(conversation_id) == [("mine", "a", "completed")]


def test_data_operations_scoped_to_current_user(client: TestClient, auth: dict[str, str]) -> None:
    """用户 alice 的批量清理不碰 bob 的数据。"""
    bob = register(client, "bob")
    bob_conversation = first_conversation(client, bob)
    seed(bob_conversation, messages=[("mine", "bob"), ("other", "hi")], context=[("user", "bob")])

    client.post("/api/data/delete-all-conversations", headers=auth)
    client.post("/api/data/clear-all-messages", headers=auth)
    client.post("/api/data/clear-all-context", headers=auth)

    assert message_rows(bob_conversation) == [
        ("mine", "bob", "completed"),
        ("other", "hi", "completed"),
    ]
    assert context_rows(bob_conversation) == [("user", "bob")]
    assert client.get("/api/data/stats", headers=bob).json()["messages"] == 2
