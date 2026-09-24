"""AI 相关路由：对话流（SSE 转发 + 四种结束方式的持久化）、显式停止、每日额度、连接测试。"""

import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import ai
from app.characters import CHARACTER_PROMPTS, DEFAULT_WORLD_SETTING, FIXED_SYSTEM_PROMPT
from app.config import settings
from app.db import SessionLocal
from app.deps import ConversationDep, DbDep, UserDep
from app.models import ContextEntry, Conversation, Message, PromptOverride, UserSettings
from app.schemas import ChatRequest, PingOut, StopOut

router = APIRouter(tags=["chat"])

CONTEXT_WINDOW = 40  # 发给上游的最近上下文条数（不含两条 system）
CHINA_TZ = timezone(timedelta(hours=8))  # 每日额度按 UTC+8 自然日统计


@dataclass
class ActiveStream:
    """一条正在转发的回复流：stop 由 /chat/stop 置位，finished 在落库完成后置位。"""

    stop: asyncio.Event = field(default_factory=asyncio.Event)
    finished: asyncio.Event = field(default_factory=asyncio.Event)


# ⚠️ 进程内登记表：会话 id → 活动流。只在生成器运行期间存在，任何结束路径都在 finally 里移除
active_streams: dict[int, ActiveStream] = {}


def count_today_messages(db: Session, user_id: int) -> int:
    """统计用户在 UTC+8 当天已发送的 mine 消息数，供额度校验与设置页展示。"""
    today = datetime.now(CHINA_TZ).date()
    day_start = datetime.combine(today, time.min, tzinfo=CHINA_TZ).astimezone(UTC)
    return db.scalar(
        select(func.count(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.user_id == user_id,
            Message.side == "mine",
            Message.created_at >= day_start,
        )
    )


def sse_frame(payload: dict[str, object]) -> str:
    """把一个 JSON 对象编码为一帧 SSE 数据。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def persist_reply(conversation_id: int, full_text: str, status: str, error: str | None) -> None:
    """把一次 AI 回复落库：按行拆成 other 消息、写错误消息、追加上下文。

    Args:
        conversation_id: 回复所属会话。
        full_text: 到结束为止收到的全部增量文本。
        status: completed（正常结束）/ aborted（显式停止或客户端断开）/ failed（上游出错）。
        error: 出错时的中文原因，只在 status 为 failed 时非空。
    """
    parts = full_text.split("\n")
    # ⚠️ 中断时最后一段是未收完的半行（也可能是空串），按契约丢弃
    if status == "aborted":
        parts = parts[:-1]
    lines = [line.strip() for line in parts if line.strip()]
    line_status = "completed" if status == "failed" else status
    with SessionLocal() as db:
        db.add_all(
            Message(conversation_id=conversation_id, side="other", text=line, status=line_status)
            for line in lines
        )
        if error is not None:
            db.add(
                Message(
                    conversation_id=conversation_id,
                    side="other",
                    text=f"[错误: {error}]",
                    status="failed",
                )
            )
        # 上下文：正常结束写完整回复，中断只写已完成的行，出错不写
        memory = full_text if status == "completed" else "\n".join(lines)
        if status != "failed" and memory:
            db.add(ContextEntry(conversation_id=conversation_id, role="assistant", content=memory))
        db.get(Conversation, conversation_id).updated_at = datetime.now(UTC)
        db.commit()


async def next_frame(
    upstream: AsyncGenerator[dict[str, object]], stop: asyncio.Event
) -> dict[str, object] | None:
    """等上游下一帧与 stop 事件中先到的一个；stop 先到或上游结束都返回 None。

    只在"每帧转发前检查事件"会让 stop 接口等到上游下一帧才返回（真实 DeepSeek 的首个 token
    可能要几秒），所以把两者一起 wait，stop 先到时取消对上游的等待，上游连接随之关闭。
    """
    frame_task = asyncio.ensure_future(anext(upstream))
    stop_task = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait({frame_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
    except asyncio.CancelledError:
        # 客户端断开：Starlette 取消本协程，把对上游的等待一并取消
        frame_task.cancel()
        raise
    finally:
        stop_task.cancel()
    if stop.is_set():
        frame_task.cancel()
        await asyncio.gather(frame_task, return_exceptions=True)
        return None
    try:
        return frame_task.result()
    except StopAsyncIteration:
        return None


async def stream_reply(
    conversation_id: int, messages: list[dict[str, str]], temperature: float, max_tokens: int
) -> AsyncIterator[str]:
    """✅ 转发上游 SSE 帧，并保证无论怎样结束都在 finally 里持久化。

    四种结束方式：上游发完（completed）、上游 / 网络出错（failed，先发一帧 error 再发
    [DONE]）、/chat/stop 显式停止（aborted，落库后 stop 接口才返回，随后发 [DONE]）、
    客户端断开（aborted，生成器在 await 处收到 CancelledError 或 GeneratorExit，作为兜底）。
    """
    stream = ActiveStream()
    active_streams[conversation_id] = stream
    upstream = ai.stream_chat(messages, temperature, max_tokens)
    full_text = ""
    status = "aborted"  # ⚠️ 默认按中断处理，只有走到流末尾才改成 completed
    error: str | None = None
    try:
        while (frame := await next_frame(upstream, stream.stop)) is not None:
            if "delta" in frame:
                full_text += frame["delta"]
            yield sse_frame(frame)
        if stream.stop.is_set():
            # 与 stop 同时到达的那一帧已丢弃，上游可能仍挂在 yield 上，显式关闭
            await upstream.aclose()
        else:
            status = "completed"
    except ai.UpstreamError as exc:
        status, error = "failed", str(exc)
        yield sse_frame({"error": error})
    finally:
        # 💡 同步写库放在 finally：取消只发生在 await 处，同步代码不会被打断
        # 详见 docs/interview.md#sse-persist
        persist_reply(conversation_id, full_text, status, error)
        if active_streams.get(conversation_id) is stream:
            del active_streams[conversation_id]
        stream.finished.set()  # 等在 /chat/stop 上的请求此刻才返回
    yield "data: [DONE]\n\n"


@router.post("/conversations/{conversation_id}/chat")
def chat(
    body: ChatRequest, conversation: ConversationDep, user: UserDep, db: DbDep
) -> StreamingResponse:
    """校验额度、保存用户消息、拼装上游请求，然后以 SSE 转发回复。"""
    if count_today_messages(db, user.id) >= settings.daily_message_limit:
        raise HTTPException(429, "今日额度已用完")
    db.add(
        Message(conversation_id=conversation.id, side="mine", text=body.text, status="completed")
    )
    db.add(ContextEntry(conversation_id=conversation.id, role="user", content=body.text))
    conversation.updated_at = datetime.now(UTC)
    db.commit()

    user_settings = db.get(UserSettings, user.id)
    world_setting = user_settings.world_setting or DEFAULT_WORLD_SETTING
    override = db.scalar(
        select(PromptOverride.prompt).where(
            PromptOverride.user_id == user.id,
            PromptOverride.character_name == conversation.character_name,
        )
    )
    character_prompt = override or CHARACTER_PROMPTS[conversation.character_name]
    # 只取最近 40 条上下文（含刚写入的这条），倒序取再翻回正序
    recent = db.scalars(
        select(ContextEntry)
        .where(ContextEntry.conversation_id == conversation.id)
        .order_by(ContextEntry.id.desc())
        .limit(CONTEXT_WINDOW)
    ).all()
    messages = [
        {"role": "system", "content": f"{FIXED_SYSTEM_PROMPT}\n\n## 世界观设定\n\n{world_setting}"},
        {"role": "system", "content": character_prompt},
        *({"role": entry.role, "content": entry.content} for entry in reversed(recent)),
    ]
    reply = stream_reply(
        conversation.id, messages, user_settings.temperature, user_settings.max_tokens
    )
    return StreamingResponse(
        reply,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/conversations/{conversation_id}/chat/stop")
async def stop_chat(conversation: ConversationDep) -> StopOut:
    """停止该会话正在进行的回复：等生成器按中断规则落库后才返回；没有活动流时 stopped 为 false。

    会话归属由 ConversationDep 校验（跨用户 404），所以用户停不了别人的流。
    """
    stream = active_streams.get(conversation.id)
    if stream is None:
        return StopOut(stopped=False)
    stream.stop.set()
    await stream.finished.wait()
    return StopOut(stopped=True)


@router.get("/ai/ping", response_model_exclude_none=True)
async def ping(_: UserDep) -> PingOut:
    """向上游发一次最小请求检查连通性；失败时返回中文原因而不是错误状态码。"""
    error = await ai.ping()
    return PingOut(ok=error is None, model=settings.deepseek_model, error=error)
