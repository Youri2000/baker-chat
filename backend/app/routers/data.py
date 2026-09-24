"""数据管理路由：统计，以及针对当前用户全部会话的三种批量清理。"""

from fastapi import APIRouter
from sqlalchemy import Select, delete, func, select

from app.characters import CHARACTER_NAMES
from app.deps import DbDep, UserDep
from app.models import ContextEntry, Conversation, Message
from app.schemas import StatsOut

router = APIRouter(prefix="/data", tags=["data"])


def user_conversation_ids(user_id: int) -> Select[tuple[int]]:
    """当前用户全部会话 id 的子查询，供各批量操作按用户圈定范围。"""
    return select(Conversation.id).where(Conversation.user_id == user_id)


@router.get("/stats")
def stats(user: UserDep, db: DbDep) -> StatsOut:
    """角色数固定 29；对话数只统计有消息的会话。"""
    scope = user_conversation_ids(user.id)
    messages = db.scalar(select(func.count(Message.id)).where(Message.conversation_id.in_(scope)))
    with_content = db.scalar(
        select(func.count(func.distinct(Message.conversation_id))).where(
            Message.conversation_id.in_(scope)
        )
    )
    return StatsOut(
        characters=len(CHARACTER_NAMES), conversations_with_content=with_content, messages=messages
    )


@router.post("/delete-all-conversations", status_code=204)
def delete_all_conversations(user: UserDep, db: DbDep) -> None:
    """删除全部会话（含消息、上下文），再为每个角色建一个新的空会话。"""
    scope = user_conversation_ids(user.id)
    db.execute(delete(Message).where(Message.conversation_id.in_(scope)))
    db.execute(delete(ContextEntry).where(ContextEntry.conversation_id.in_(scope)))
    db.execute(delete(Conversation).where(Conversation.user_id == user.id))
    db.add_all(Conversation(user_id=user.id, character_name=name) for name in CHARACTER_NAMES)
    db.commit()


@router.post("/clear-all-messages", status_code=204)
def clear_all_messages(user: UserDep, db: DbDep) -> None:
    """清空全部可见消息，上下文保留。"""
    db.execute(delete(Message).where(Message.conversation_id.in_(user_conversation_ids(user.id))))
    db.commit()


@router.post("/clear-all-context", status_code=204)
def clear_all_context(user: UserDep, db: DbDep) -> None:
    """清空全部 AI 上下文，可见消息保留。"""
    db.execute(
        delete(ContextEntry).where(ContextEntry.conversation_id.in_(user_conversation_ids(user.id)))
    )
    db.commit()
