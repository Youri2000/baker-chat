"""对话流测试：SSE 转发、上下文截断、每日额度、上游错误映射、显式停止、断开持久化、mock 与 ping。"""

import asyncio
import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.ai import MOCK_TEXT
from app.characters import CHARACTER_PROMPTS, DEFAULT_WORLD_SETTING, FIXED_SYSTEM_PROMPT
from app.config import settings
from app.db import SessionLocal
from app.models import Conversation
from app.routers.chat import ActiveStream, active_streams, stop_chat, stream_reply
from tests.conftest import (
    context_rows,
    first_conversation,
    message_rows,
    mock_upstream,
    register,
    seed,
    sse_events,
)

CHAT_MESSAGES = [{"role": "user", "content": "hi"}]


def test_forwards_delta_and_usage_frames(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """增量原样转发、usage 转发、以 [DONE] 结束；回复按行拆成 3 条 other 消息并写入上下文。"""
    route = mock_upstream(
        upstream,
        "第一行\n第二",
        "行\n第三行",
        usage={"prompt_tokens": 812, "completion_tokens": 45, "total_tokens": 857},
    )
    conversation_id = first_conversation(client, auth)

    with client.stream(
        "POST", f"/api/conversations/{conversation_id}/chat", json={"text": " 你好 "}, headers=auth
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        payloads = [line[5:].strip() for line in response.iter_lines() if line.startswith("data:")]
    assert [json.loads(p) for p in payloads[:-1]] == [
        {"delta": "第一行\n第二"},
        {"delta": "行\n第三行"},
        {"usage": {"prompt_tokens": 812, "completion_tokens": 45}},
    ]
    assert payloads[-1] == "[DONE]"

    sent = json.loads(route.calls.last.request.content)
    assert route.calls.last.request.headers["authorization"] == "Bearer test-key"
    assert (sent["model"], sent["stream"], sent["stream_options"]) == (
        "deepseek-test",
        True,
        {"include_usage": True},
    )
    assert (sent["temperature"], sent["max_tokens"]) == (0.8, 2048)
    # 角色闲聊关闭思考模式：否则思考 token 计入 max_tokens，答案还要等思考结束后整段到达
    assert sent["thinking"] == {"type": "disabled"}

    assert message_rows(conversation_id) == [
        ("mine", "你好", "completed"),
        ("other", "第一行", "completed"),
        ("other", "第二行", "completed"),
        ("other", "第三行", "completed"),
    ]
    assert context_rows(conversation_id) == [
        ("user", "你好"),
        ("assistant", "第一行\n第二行\n第三行"),
    ]


def test_context_window_keeps_last_40(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """已有 60 条上下文时，发给上游的是 2 条 system + 最近 40 条（含本条）。"""
    route = mock_upstream(upstream, "ok")
    conversation_id = first_conversation(client, auth)
    history = [("user" if i % 2 == 0 else "assistant", f"h{i}") for i in range(60)]
    seed(conversation_id, context=history)

    sse_events(client, auth, conversation_id, "第61条")

    sent = json.loads(route.calls.last.request.content)["messages"]
    assert len(sent) == 42
    assert sent[0] == {
        "role": "system",
        "content": f"{FIXED_SYSTEM_PROMPT}\n\n## 世界观设定\n\n{DEFAULT_WORLD_SETTING}",
    }
    assert sent[1] == {"role": "system", "content": CHARACTER_PROMPTS["梨诺"]}
    expected = [{"role": role, "content": content} for role, content in history[21:]]
    assert sent[2:] == [*expected, {"role": "user", "content": "第61条"}]
    # 可见消息不受截断影响：只有本次的一问一答
    assert message_rows(conversation_id) == [
        ("mine", "第61条", "completed"),
        ("other", "ok", "completed"),
    ]


def test_uses_prompt_override_and_custom_world_setting(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """用户覆盖的角色提示词与自定义世界观进入 system 消息。"""
    route = mock_upstream(upstream, "ok")
    conversation_id = first_conversation(client, auth)
    client.put("/api/prompts/梨诺", json={"prompt": "自定义梨诺"}, headers=auth)
    client.patch(
        "/api/settings", json={"world_setting": "自定义世界", "temperature": 1.3}, headers=auth
    )

    sse_events(client, auth, conversation_id, "你好")

    sent = json.loads(route.calls.last.request.content)
    assert sent["messages"][0]["content"].endswith("## 世界观设定\n\n自定义世界")
    assert sent["messages"][1]["content"] == "自定义梨诺"
    assert sent["temperature"] == 1.3


def test_daily_limit_429_and_message_not_saved(
    client: TestClient,
    auth: dict[str, str],
    upstream: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """达到每日额度后返回 429，这条消息不落库也不请求上游。"""
    route = mock_upstream(upstream, "ok")
    monkeypatch.setattr(settings, "daily_message_limit", 2)
    conversation_id = first_conversation(client, auth)
    sse_events(client, auth, conversation_id, "第一条")
    sse_events(client, auth, conversation_id, "第二条")

    response = client.post(
        f"/api/conversations/{conversation_id}/chat", json={"text": "第三条"}, headers=auth
    )
    assert response.status_code == 429
    assert response.json()["detail"] == "今日额度已用完"
    assert route.call_count == 2
    assert [m for m in message_rows(conversation_id) if m[0] == "mine"] == [
        ("mine", "第一条", "completed"),
        ("mine", "第二条", "completed"),
    ]
    used = client.get("/api/settings", headers=auth).json()
    assert (used["daily_used"], used["daily_limit"]) == (2, 2)


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (401, "上游认证失败（401）"),
        (403, "上游认证失败（403）"),
        (429, "上游限流，请稍后再试"),
        (503, "上游服务异常（503）"),
        (400, "上游请求失败：HTTP 400"),
    ],
)
def test_upstream_http_error_becomes_error_frame(
    client: TestClient,
    auth: dict[str, str],
    upstream: respx.MockRouter,
    status: int,
    message: str,
) -> None:
    """上游非 200：发一帧中文 error 后 [DONE]，落一条 failed 消息，不写 assistant 上下文。"""
    upstream.post("/chat/completions").mock(return_value=httpx.Response(status, json={"error": {}}))
    conversation_id = first_conversation(client, auth)

    assert sse_events(client, auth, conversation_id, "你好") == [{"error": message}, "[DONE]"]
    assert message_rows(conversation_id) == [
        ("mine", "你好", "completed"),
        ("other", f"[错误: {message}]", "failed"),
    ]
    assert context_rows(conversation_id) == [("user", "你好")]


@pytest.mark.parametrize(
    ("exc", "message"),
    [
        (httpx.ReadTimeout("read timed out"), "上游响应超时"),
        (httpx.ConnectTimeout("connect timed out"), "上游响应超时"),
        (httpx.ConnectError("boom"), "上游请求失败：boom"),
        (httpx.ReadError(""), "上游请求失败：ReadError"),  # str 为空时回落到异常类名
    ],
)
def test_upstream_transport_error_becomes_error_frame(
    client: TestClient,
    auth: dict[str, str],
    upstream: respx.MockRouter,
    exc: Exception,
    message: str,
) -> None:
    """超时与连接失败映射为对应中文原因。"""
    upstream.post("/chat/completions").mock(side_effect=exc)
    conversation_id = first_conversation(client, auth)

    assert sse_events(client, auth, conversation_id, "你好") == [{"error": message}, "[DONE]"]
    assert message_rows(conversation_id)[-1] == ("other", f"[错误: {message}]", "failed")


def test_error_after_partial_content_keeps_received_lines(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """流中途断掉：已收到的文本按行保存，再追加 failed 错误消息。"""

    async def body() -> AsyncIterator[bytes]:
        chunk = {"choices": [{"delta": {"content": "第一行\n第二"}}]}
        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        raise httpx.ReadError("connection lost")

    upstream.post("/chat/completions").mock(return_value=httpx.Response(200, content=body()))
    conversation_id = first_conversation(client, auth)

    assert sse_events(client, auth, conversation_id, "你好") == [
        {"delta": "第一行\n第二"},
        {"error": "上游请求失败：connection lost"},
        "[DONE]",
    ]
    assert message_rows(conversation_id)[1:] == [
        ("other", "第一行", "completed"),
        ("other", "第二", "completed"),
        ("other", "[错误: 上游请求失败：connection lost]", "failed"),
    ]
    assert context_rows(conversation_id) == [("user", "你好")]


def test_client_disconnect_persists_completed_lines_as_aborted(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """生成器被 aclose()（客户端断开）：已完成的行保存为 aborted，半行丢弃，上下文只写完整行。"""
    mock_upstream(upstream, "第一行\n第二", "行\n第三", "行", "\n第四行")
    conversation_id = first_conversation(client, auth)

    async def drive() -> list[str]:
        generator = stream_reply(conversation_id, CHAT_MESSAGES, 0.8, 100)
        received = [await anext(generator), await anext(generator)]
        await generator.aclose()
        return received

    frames = asyncio.run(drive())
    assert [json.loads(frame[5:]) for frame in frames] == [
        {"delta": "第一行\n第二"},
        {"delta": "行\n第三"},
    ]
    assert message_rows(conversation_id) == [
        ("other", "第一行", "aborted"),
        ("other", "第二行", "aborted"),
    ]
    assert context_rows(conversation_id) == [("assistant", "第一行\n第二行")]


def test_stop_returns_after_persist_without_waiting_for_upstream(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """/chat/stop：上游发完 2 帧后永远不再出数据，stop 仍立即返回。

    返回时已按中断规则落库（完整行 aborted、半行丢弃、上下文只含完整行）；随后流以 [DONE]
    结束，登记表清空。
    """
    never = asyncio.Event()

    async def body() -> AsyncIterator[bytes]:
        for delta in ("第一行\n第二", "行\n第三"):
            chunk = {"choices": [{"delta": {"content": delta}}]}
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        await never.wait()  # 模拟上游长时间不出下一个 token

    upstream.post("/chat/completions").mock(return_value=httpx.Response(200, content=body()))
    conversation_id = first_conversation(client, auth)
    with SessionLocal() as db:
        conversation = db.get(Conversation, conversation_id)

    async def drive() -> tuple[list[str], list[tuple[str, str, str]], bool]:
        generator = stream_reply(conversation_id, CHAT_MESSAGES, 0.8, 100)
        frames = [await anext(generator), await anext(generator)]
        pull = asyncio.ensure_future(anext(generator))
        await asyncio.sleep(0.01)  # 让 pull 真正挂在对上游第 3 帧的等待上
        result = await asyncio.wait_for(stop_chat(conversation), 2)
        rows_when_returned = message_rows(conversation_id)
        frames.append(await pull)
        return frames, rows_when_returned, result.stopped

    frames, rows_when_returned, stopped = asyncio.run(drive())
    assert stopped is True
    assert [json.loads(frame[5:]) for frame in frames[:2]] == [
        {"delta": "第一行\n第二"},
        {"delta": "行\n第三"},
    ]
    assert frames[2] == "data: [DONE]\n\n"
    assert rows_when_returned == [
        ("other", "第一行", "aborted"),
        ("other", "第二行", "aborted"),
    ]
    assert context_rows(conversation_id) == [("assistant", "第一行\n第二行")]
    assert conversation_id not in active_streams


def test_stop_without_active_stream_returns_false(client: TestClient, auth: dict[str, str]) -> None:
    """没有活动流时 /chat/stop 直接返回 200 {"stopped": false}。"""
    conversation_id = first_conversation(client, auth)
    response = client.post(f"/api/conversations/{conversation_id}/chat/stop", headers=auth)
    assert response.status_code == 200
    assert response.json() == {"stopped": False}


def test_stop_endpoint_signals_registered_stream(client: TestClient, auth: dict[str, str]) -> None:
    """有登记的活动流时：置位 stop、等到 finished 后返回 {"stopped": true}。"""
    conversation_id = first_conversation(client, auth)
    stream = ActiveStream()
    stream.finished.set()  # 生成器落库后才置位；这里预先置位，只验证接口本身
    active_streams[conversation_id] = stream
    try:
        response = client.post(f"/api/conversations/{conversation_id}/chat/stop", headers=auth)
    finally:
        del active_streams[conversation_id]
    assert response.json() == {"stopped": True}
    assert stream.stop.is_set()


def test_stop_other_users_conversation_404(client: TestClient, auth: dict[str, str]) -> None:
    """用 B 的 token 停 A 的会话返回 404 且 A 的流不受影响；未登录 401。"""
    conversation_id = first_conversation(client, auth)
    stream = ActiveStream()
    active_streams[conversation_id] = stream
    try:
        bob = register(client, "bob")
        response = client.post(f"/api/conversations/{conversation_id}/chat/stop", headers=bob)
        assert response.status_code == 404
        assert not stream.stop.is_set()
        assert client.post(f"/api/conversations/{conversation_id}/chat/stop").status_code == 401
    finally:
        del active_streams[conversation_id]


def test_conversation_deleted_mid_stream_ends_cleanly(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """流进行中会话被删除：不抛异常、仍以 [DONE] 收尾、登记表清空，且不写任何回复。"""
    monkeypatch.setattr(settings, "ai_mock", True)
    created = client.post("/api/conversations", json={"character_name": "梨诺"}, headers=auth)
    conversation_id = created.json()["id"]  # 该角色已有 2 段会话，删除这段不会 409

    async def drive() -> list[str]:
        generator = stream_reply(conversation_id, CHAT_MESSAGES, 0.8, 100)
        frames = [await anext(generator)]
        deleted = client.delete(f"/api/conversations/{conversation_id}", headers=auth)
        assert deleted.status_code == 204
        async for frame in generator:
            frames.append(frame)
        return frames

    frames = asyncio.run(drive())
    assert frames[-1] == "data: [DONE]\n\n"
    assert active_streams == {}
    assert message_rows(conversation_id) == []
    assert context_rows(conversation_id) == []


def test_task_cancellation_persists_as_aborted(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成器在 await 处被取消（Starlette 检测到断开的方式）：同样走 finally 持久化。"""
    monkeypatch.setattr(settings, "ai_mock", True)
    conversation_id = first_conversation(client, auth)

    async def drive() -> None:
        generator = stream_reply(conversation_id, CHAT_MESSAGES, 0.8, 100)
        await anext(generator)  # "收到，管理"
        await anext(generator)  # "员。\n这是"

        async def pull_next() -> str:
            return await anext(generator)

        task = asyncio.create_task(pull_next())
        await asyncio.sleep(0.01)  # 让任务进入 mock 的 sleep 再取消
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert message_rows(conversation_id) == [("other", "收到，管理员。", "aborted")]
    assert context_rows(conversation_id) == [("assistant", "收到，管理员。")]


def test_mock_stream_when_ai_mock(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """AI_MOCK=1：不请求上游，分块发送固定文本并按行落库。"""
    monkeypatch.setattr(settings, "ai_mock", True)
    conversation_id = first_conversation(client, auth)

    events = sse_events(client, auth, conversation_id, "你好")
    deltas = [e["delta"] for e in events if isinstance(e, dict)]
    assert "".join(deltas) == MOCK_TEXT
    assert len(deltas) == 7
    assert events[-1] == "[DONE]"
    assert message_rows(conversation_id)[1:] == [
        ("other", "收到，管理员。", "completed"),
        ("other", "这是一条来自 mock 的回复。", "completed"),
        ("other", "第三行用于验证分段。", "completed"),
    ]
    assert active_streams == {}  # 正常结束同样注销活动流


def test_blank_text_422(client: TestClient, auth: dict[str, str]) -> None:
    """只有空白的文本返回 422，不落库。"""
    conversation_id = first_conversation(client, auth)
    response = client.post(
        f"/api/conversations/{conversation_id}/chat", json={"text": " \n\t"}, headers=auth
    )
    assert response.status_code == 422
    assert message_rows(conversation_id) == []


def test_ping_ok(client: TestClient, auth: dict[str, str], upstream: respx.MockRouter) -> None:
    """连接测试成功：非流式、max_tokens=1，响应不带 error 字段。"""
    route = upstream.post("/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "p"}}]})
    )
    response = client.get("/api/ai/ping", headers=auth)
    assert response.json() == {"ok": True, "model": "deepseek-test"}
    sent = json.loads(route.calls.last.request.content)
    assert sent["max_tokens"] == 1 and "stream" not in sent


def test_ping_failure_reasons(
    client: TestClient, auth: dict[str, str], upstream: respx.MockRouter
) -> None:
    """连接测试失败：状态码与超时都映射为中文原因，HTTP 仍是 200。"""
    upstream.post("/chat/completions").mock(return_value=httpx.Response(401))
    assert client.get("/api/ai/ping", headers=auth).json() == {
        "ok": False,
        "model": "deepseek-test",
        "error": "上游认证失败（401）",
    }
    upstream.post("/chat/completions").mock(side_effect=httpx.ConnectTimeout("slow"))
    assert client.get("/api/ai/ping", headers=auth).json()["error"] == "上游响应超时"


def test_ping_mock_and_auth(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """AI_MOCK=1 时直接成功；未登录返回 401。"""
    monkeypatch.setattr(settings, "ai_mock", True)
    assert client.get("/api/ai/ping", headers=auth).json() == {"ok": True, "model": "deepseek-test"}
    assert client.get("/api/ai/ping").status_code == 401
