"""密码哈希与 JWT 签发 / 校验，被 auth 路由和 get_current_user 依赖使用。"""

from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import settings

TOKEN_TTL = timedelta(days=7)
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """用 bcrypt 生成带随机盐的密码哈希。"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """校验明文密码是否与哈希匹配。"""
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_token(user_id: int) -> str:
    """签发 7 天有效的 HS256 JWT，sub 为用户 id 字符串。"""
    payload = {"sub": str(user_id), "exp": datetime.now(UTC) + TOKEN_TTL}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    """解析 JWT 并返回用户 id；签名错误或过期时抛出 jwt.PyJWTError。"""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    return int(payload["sub"])
