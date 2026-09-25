"""Pydantic 请求 / 响应模型，字段与 docs/api.md 一一对应；从 ORM 输出的模型开启 from_attributes。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.characters import CHARACTER_NAMES


class AuthRequest(BaseModel):
    """注册请求体，带完整的用户名 / 密码格式校验。

    密码 6–64 个字符、不限字符集；bcrypt 只接受 72 字节，UTF-8 编码超出时在这里拒绝而不是静默截断。
    """

    username: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=6, max_length=64)

    @field_validator("password")
    @classmethod
    def check_password_bytes(cls, value: str) -> str:
        """UTF-8 编码超过 bcrypt 的 72 字节上限（含中文时 24 个字）以 422 拒绝。"""
        if len(value.encode()) > 72:
            raise ValueError("密码为 6–64 位；含中文时最多 24 个字")
        return value


class LoginRequest(BaseModel):
    """登录请求体：只要求非空，不做格式校验。

    格式不合规的凭据必然匹配不到用户，交给路由统一返回 401，而不是暴露 422 校验数组。
    """

    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserOut(BaseModel):
    """对外暴露的用户信息，不含任何密码字段。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str


class AuthResponse(BaseModel):
    """注册 / 登录成功的响应：JWT 与用户信息。"""

    token: str
    user: UserOut


class LastMessage(BaseModel):
    """会话列表里给子卡预览用的最后一条消息。"""

    side: Literal["mine", "other"]
    text: str


class ConversationOut(BaseModel):
    """会话列表项。"""

    id: int
    character_name: str
    last_message: LastMessage | None
    created_at: datetime
    updated_at: datetime


class ConversationCreate(BaseModel):
    """新建会话请求体，角色名必须是 29 个内置角色之一。"""

    character_name: str

    @field_validator("character_name")
    @classmethod
    def check_character(cls, value: str) -> str:
        """未知角色名以 422 拒绝。"""
        if value not in CHARACTER_NAMES:
            raise ValueError("角色不存在")
        return value


class MessageOut(BaseModel):
    """可见消息。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    side: Literal["mine", "other"]
    text: str
    status: Literal["completed", "aborted", "failed"]
    created_at: datetime


class ChatRequest(BaseModel):
    """发送消息请求体；文本去掉首尾空白后不能为空。"""

    text: str

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        """去首尾空白，空文本以 422 拒绝。"""
        value = value.strip()
        if not value:
            raise ValueError("消息不能为空")
        return value


class SettingsOut(BaseModel):
    """设置响应；world_setting 为实际生效文本，model / daily_* 为只读字段。"""

    temperature: float
    max_tokens: int
    world_setting: str
    world_setting_is_default: bool
    my_gender: Literal["male", "female"]
    strip_variant: Literal[0, 1, 2]
    model: str
    daily_limit: int
    daily_used: int


class SettingsPatch(BaseModel):
    """设置的部分更新；未出现的字段保持不变，world_setting 传空串表示恢复默认。"""

    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=8192)
    world_setting: str | None = None
    my_gender: Literal["male", "female"] | None = None
    strip_variant: Literal[0, 1, 2] | None = None

    @field_validator("world_setting")
    @classmethod
    def blank_means_default(cls, value: str | None) -> str | None:
        """纯空白视为恢复默认：存空串，否则发给 AI 的世界观就是一段空白。"""
        if value is not None and not value.strip():
            return ""
        return value


class CharacterPromptOut(BaseModel):
    """角色提示词：生效文本以及是否为用户自定义。"""

    character_name: str
    prompt: str
    is_custom: bool


class PromptPut(BaseModel):
    """保存角色提示词请求体。"""

    prompt: str


class PingOut(BaseModel):
    """AI 连接测试结果；error 只在失败时出现。"""

    ok: bool
    model: str
    error: str | None = None


class StopOut(BaseModel):
    """停止生成的结果：stopped 为 true 表示确实停掉了一条活动流且已落库。"""

    stopped: bool


class StatsOut(BaseModel):
    """数据管理页的统计数字。"""

    characters: int
    conversations_with_content: int
    messages: int
