"""DeepSeek 客户端：流式对话、连接测试与 AI_MOCK 假流；上游错误统一映射为中文原因。"""

import asyncio
import json
from collections.abc import AsyncIterator

import httpx

from app.config import settings

TIMEOUT = httpx.Timeout(connect=10, read=60, write=10, pool=10)
MOCK_TEXT = "收到，管理员。\n这是一条来自 mock 的回复。\n第三行用于验证分段。"
MOCK_CHUNK_SIZE = 5  # 故意不与行边界对齐，让前端的行缓冲逻辑真正被用到
MOCK_INTERVAL = 0.08


class UpstreamError(Exception):
    """上游 DeepSeek 请求失败；异常消息即面向用户的中文原因。"""


def _status_message(status: int) -> str:
    """把上游 HTTP 状态码映射为 docs/api.md 第 3 节规定的中文原因。"""
    if status in (401, 403):
        return f"上游认证失败（{status}）"
    if status == 429:
        return "上游限流，请稍后再试"
    if status >= 500:
        return f"上游服务异常（{status}）"
    return f"上游请求失败：HTTP {status}"


def _transport_message(exc: Exception) -> str:
    """把 httpx 传输层异常（超时、连接失败、坏响应）映射为中文原因。"""
    if isinstance(exc, httpx.TimeoutException):
        return "上游响应超时"
    return f"上游请求失败：{exc}"


def _client() -> httpx.AsyncClient:
    """带鉴权头与超时配置的上游客户端，每次请求新建、用完即关。"""
    return httpx.AsyncClient(
        base_url=settings.deepseek_base_url,
        timeout=TIMEOUT,
        headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
    )


async def _mock_stream() -> AsyncIterator[dict[str, object]]:
    """AI_MOCK=1 时的假流：把固定文本按 5 字一块、每块间隔 80ms 发出。"""
    for start in range(0, len(MOCK_TEXT), MOCK_CHUNK_SIZE):
        await asyncio.sleep(MOCK_INTERVAL)
        yield {"delta": MOCK_TEXT[start : start + MOCK_CHUNK_SIZE]}


async def stream_chat(
    messages: list[dict[str, str]], temperature: float, max_tokens: int
) -> AsyncIterator[dict[str, object]]:
    """✅ 以 SSE 请求上游并逐帧产出 {"delta": str} 与 {"usage": {...}}。

    上游非 200、超时或传输错误都抛出 UpstreamError，由 chat 路由转成错误帧。
    """
    if settings.ai_mock:
        async for frame in _mock_stream():
            yield frame
        return
    body = {
        "model": settings.deepseek_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    try:
        async with (
            _client() as client,
            client.stream("POST", "/chat/completions", json=body) as response,
        ):
            if response.status_code != 200:
                raise UpstreamError(_status_message(response.status_code))
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                content = choices[0]["delta"].get("content") if choices else None
                if content:
                    yield {"delta": content}
                # 开启 stream_options.include_usage 后，上游最后一帧 choices 为空、只带 usage
                usage = chunk.get("usage")
                if usage:
                    yield {
                        "usage": {
                            "prompt_tokens": usage["prompt_tokens"],
                            "completion_tokens": usage["completion_tokens"],
                        }
                    }
    except (httpx.HTTPError, ValueError) as exc:
        raise UpstreamError(_transport_message(exc)) from exc


async def ping() -> str | None:
    """向上游发一次 max_tokens=1 的非流式请求；成功返回 None，失败返回中文原因。"""
    if settings.ai_mock:
        return None
    body = {
        "model": settings.deepseek_model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
    }
    try:
        async with _client() as client:
            response = await client.post("/chat/completions", json=body)
    except httpx.HTTPError as exc:
        return _transport_message(exc)
    if response.status_code != 200:
        return _status_message(response.status_code)
    return None
