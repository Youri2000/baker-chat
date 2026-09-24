"""FastAPI 依赖：解析当前用户，以及解析"属于当前用户的会话"（跨用户一律 404）。"""

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Conversation, User
from app.security import decode_token

bearer = HTTPBearer(auto_error=False)
DbDep = Annotated[Session, Depends(get_db)]


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: DbDep,
) -> User:
    """从 Authorization: Bearer 头解析用户；缺失、无效、过期或用户不存在都返回 401。"""
    unauthorized = HTTPException(401, "未登录或登录已过期")
    if credentials is None:
        raise unauthorized
    try:
        user_id = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise unauthorized from None
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


UserDep = Annotated[User, Depends(get_current_user)]


def get_conversation(conversation_id: int, user: UserDep, db: DbDep) -> Conversation:
    """按路径参数取会话；不存在或不属于当前用户都返回 404，避免泄露他人会话是否存在。"""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise HTTPException(404, "会话不存在")
    return conversation


ConversationDep = Annotated[Conversation, Depends(get_conversation)]
