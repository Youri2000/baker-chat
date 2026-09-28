"""会话与消息接口测试：排序、新建、删除 409、跨用户 404、消息游标分页、清空消息与清空上下文。"""

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

    page = client.get(f"/api/conversations/{conversation_id}/messages", headers=auth).json()
    assert page["has_more"] is False
    messages = page["items"]
    assert [(m["side"], m["text"], m["status"]) for m in messages] == [
        ("mine", "你好", "completed"),
        ("other", "管理员好[sns_emoji_001]", "completed"),
    ]
    assert messages[0]["created_at"].endswith("Z") or "+00:00" in messages[0]["created_at"]

    conversations = client.get("/api/conversations", headers=auth).json()
    assert conversations[0]["last_message"] == {"side": "other", "text": "管理员好[sns_emoji_001]"}


def get_page(
    client: TestClient, auth: dict[str, str], conversation_id: int, **params: int
) -> dict[str, object]:
    """请求一页消息，返回 {ids, has_more}；ids 为本页消息 id 列表。"""
    response = client.get(
        f"/api/conversations/{conversation_id}/messages", params=params, headers=auth
    )
    assert response.status_code == 200, response.text
    page = response.json()
    return {"ids": [m["id"] for m in page["items"]], "has_more": page["has_more"]}


def test_messages_paged_by_before_id(client: TestClient, auth: dict[str, str]) -> None:
    """120 条消息：默认取最近 50 条，再以 before_id 依次向前翻页，每页都按 id 升序。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", str(n)) for n in range(1, 121)])

    # 不带参数即最新一页，默认 limit 为 50
    assert get_page(client, auth, conversation_id) == {
        "ids": list(range(71, 121)),
        "has_more": True,
    }
    assert get_page(client, auth, conversation_id, before_id=71) == {
        "ids": list(range(21, 71)),
        "has_more": True,
    }
    # 最后一页不足 limit 条，has_more 为 false
    assert get_page(client, auth, conversation_id, before_id=21) == {
        "ids": list(range(1, 21)),
        "has_more": False,
    }


def test_messages_page_isolated_with_interleaved_ids(
    client: TestClient, auth: dict[str, str]
) -> None:
    """两个会话交替写入（消息 id 全库共用一个序列）：每页只含本会话的消息，before_id 按 id 比较。"""
    conversations = client.get("/api/conversations", headers=auth).json()
    first, second = conversations[0]["id"], conversations[1]["id"]
    for n in range(1, 7):
        seed(first, messages=[("mine", f"甲{n}")])
        seed(second, messages=[("other", f"乙{n}")])
    first_ids = get_page(client, auth, first, limit=100)["ids"]
    second_ids = get_page(client, auth, second, limit=100)["ids"]

    # 各自只有 6 条，互不混入
    assert len(first_ids) == 6
    assert len(second_ids) == 6
    assert set(first_ids).isdisjoint(second_ids)
    assert get_page(client, auth, first, limit=3) == {"ids": first_ids[3:], "has_more": True}
    # 以另一会话的 id 作 before_id：取本会话中 id 更小的最近 3 条
    pivot = second_ids[3]
    older = [i for i in first_ids if i < pivot]
    assert get_page(client, auth, first, before_id=pivot, limit=3) == {
        "ids": older[-3:],
        "has_more": len(older) > 3,
    }


def test_messages_has_more_at_exact_limit(client: TestClient, auth: dict[str, str]) -> None:
    """条数恰好等于 limit 时 has_more 为 false，多一条才为 true。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", str(n)) for n in range(1, 4)])

    assert get_page(client, auth, conversation_id, limit=3) == {
        "ids": [1, 2, 3],
        "has_more": False,
    }
    assert get_page(client, auth, conversation_id, limit=2) == {"ids": [2, 3], "has_more": True}


def test_messages_limit_bounds(client: TestClient, auth: dict[str, str]) -> None:
    """分页大小只接受 1–100：limit 为 0 与 101 返回 422，边界值 1 与 100 正常返回。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", str(n)) for n in range(1, 121)])
    url = f"/api/conversations/{conversation_id}/messages"

    for limit in (0, 101):
        assert client.get(url, params={"limit": limit}, headers=auth).status_code == 422
    assert get_page(client, auth, conversation_id, limit=1) == {"ids": [120], "has_more": True}
    assert get_page(client, auth, conversation_id, limit=100) == {
        "ids": list(range(21, 121)),
        "has_more": True,
    }


def test_messages_empty_conversation(client: TestClient, auth: dict[str, str]) -> None:
    """没有消息的会话返回空页，has_more 为 false。"""
    conversation_id = first_conversation(client, auth)
    response = client.get(f"/api/conversations/{conversation_id}/messages", headers=auth)
    assert response.json() == {"items": [], "has_more": False}


def test_clear_messages_keeps_context(client: TestClient, auth: dict[str, str]) -> None:
    """清空消息后可见消息为空，AI 上下文原样保留。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "记住 42")], context=[("user", "记住 42")])

    response = client.post(f"/api/conversations/{conversation_id}/messages/clear", headers=auth)
    assert response.status_code == 204
    assert client.get(f"/api/conversations/{conversation_id}/messages", headers=auth).json() == {
        "items": [],
        "has_more": False,
    }
    assert context_rows(conversation_id) == [("user", "记住 42")]


def test_clear_context_keeps_messages(client: TestClient, auth: dict[str, str]) -> None:
    """清空上下文后 AI 记忆为空，可见消息原样保留。"""
    conversation_id = first_conversation(client, auth)
    seed(conversation_id, messages=[("mine", "记住 42")], context=[("user", "记住 42")])

    response = client.post(f"/api/conversations/{conversation_id}/context/clear", headers=auth)
    assert response.status_code == 204
    assert context_rows(conversation_id) == []
    assert message_rows(conversation_id) == [("mine", "记住 42", "completed")]
