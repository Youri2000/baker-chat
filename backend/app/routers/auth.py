"""鉴权路由：注册、登录、当前用户；create_user 同时被 main.py 的演示账号种子复用。"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.characters import CHARACTER_NAMES
from app.deps import DbDep, UserDep
from app.models import Conversation, User, UserSettings
from app.schemas import AuthRequest, AuthResponse, UserOut
from app.security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def create_user(db: Session, username: str, password: str) -> User:
    """创建用户，并一次性建好默认设置与 29 个角色各一个空会话。"""
    user = User(username=username, password_hash=hash_password(password))
    db.add(user)
    db.flush()  # 先拿到 user.id 再建关联行
    db.add(UserSettings(user_id=user.id))
    db.add_all(Conversation(user_id=user.id, character_name=name) for name in CHARACTER_NAMES)
    db.commit()
    return user


@router.post("/register", status_code=201)
def register(body: AuthRequest, db: DbDep) -> AuthResponse:
    """注册新账号；用户名已存在返回 409。"""
    if db.scalar(select(User).where(User.username == body.username)) is not None:
        raise HTTPException(409, "用户名已被占用")
    user = create_user(db, body.username, body.password)
    return AuthResponse(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login")
def login(body: AuthRequest, db: DbDep) -> AuthResponse:
    """登录；用户不存在与密码错误返回同一个 401，不区分原因。"""
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    return AuthResponse(token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me")
def me(user: UserDep) -> UserOut:
    """返回当前登录用户。"""
    return UserOut.model_validate(user)
