"""会话与消息路由：列表、新建、删除、消息列表、清空消息、清空上下文；全部按当前用户过滤。"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, func, select

from app.characters import CHARACTER_NAMES
from app.deps import ConversationDep, DbDep, UserDep
from app.models import ContextEntry, Conversation, Message
from app.schemas import ConversationCreate, ConversationOut, LastMessage, MessageOut

router = APIRouter(prefix="/conversations", tags=["conversations"])


def to_conversation_out(conversation: Conversation, last: Message | None) -> ConversationOut:
    """把会话与它的最后一条消息组装成列表项。"""
    return ConversationOut(
        id=conversation.id,
        character_name=conversation.character_name,
        last_message=LastMessage(side=last.side, text=last.text) if last else None,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


@router.get("")
def list_conversations(user: UserDep, db: DbDep) -> list[ConversationOut]:
    """列出当前用户全部会话：先按角色内置顺序，再按创建时间升序。"""
    conversations = db.scalars(select(Conversation).where(Conversation.user_id == user.id)).all()
    # 一条查询取出每个会话的最后一条消息，避免逐会话 N+1
    last_ids = (
        select(func.max(Message.id))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id == user.id)
        .group_by(Message.conversation_id)
    )
    last_by_conversation = {
        message.conversation_id: message
        for message in db.scalars(select(Message).where(Message.id.in_(last_ids)))
    }
    ordered = sorted(
        conversations,
        key=lambda c: (CHARACTER_NAMES.index(c.character_name), c.created_at, c.id),
    )
    return [to_conversation_out(c, last_by_conversation.get(c.id)) for c in ordered]


@router.post("", status_code=201)
def create_conversation(body: ConversationCreate, user: UserDep, db: DbDep) -> ConversationOut:
    """为某个角色新建一段空会话。"""
    conversation = Conversation(user_id=user.id, character_name=body.character_name)
    db.add(conversation)
    db.commit()
    return to_conversation_out(conversation, None)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation: ConversationDep, db: DbDep) -> None:
    """删除会话及其消息、上下文；该角色只剩这一段时返回 409。"""
    remaining = db.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(
            Conversation.user_id == conversation.user_id,
            Conversation.character_name == conversation.character_name,
        )
    )
    if remaining <= 1:
        raise HTTPException(409, "该角色至少保留一个会话")
    db.execute(delete(Message).where(Message.conversation_id == conversation.id))
    db.execute(delete(ContextEntry).where(ContextEntry.conversation_id == conversation.id))
    db.delete(conversation)
    db.commit()


@router.get("/{conversation_id}/messages")
def list_messages(conversation: ConversationDep, db: DbDep) -> list[MessageOut]:
    """按 id 升序返回会话的可见消息。"""
    messages = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id)
    ).all()
    return [MessageOut.model_validate(m) for m in messages]


@router.post("/{conversation_id}/messages/clear", status_code=204)
def clear_messages(conversation: ConversationDep, db: DbDep) -> None:
    """只清可见消息，AI 上下文保留。"""
    db.execute(delete(Message).where(Message.conversation_id == conversation.id))
    db.commit()


@router.post("/{conversation_id}/context/clear", status_code=204)
def clear_context(conversation: ConversationDep, db: DbDep) -> None:
    """只清 AI 上下文，可见消息保留。"""
    db.execute(delete(ContextEntry).where(ContextEntry.conversation_id == conversation.id))
    db.commit()
