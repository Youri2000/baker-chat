"""设置路由：读取与部分更新用户设置；只读字段（模型名、额度）来自配置与当日统计。"""

from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.characters import DEFAULT_WORLD_SETTING
from app.config import settings
from app.deps import DbDep, UserDep
from app.models import User, UserSettings
from app.routers.chat import count_today_messages
from app.schemas import SettingsOut, SettingsPatch

router = APIRouter(prefix="/settings", tags=["settings"])


def to_settings_out(db: Session, user: User, user_settings: UserSettings) -> SettingsOut:
    """组装设置响应：空世界观替换为默认文本，并附上只读字段。"""
    return SettingsOut(
        temperature=user_settings.temperature,
        max_tokens=user_settings.max_tokens,
        world_setting=user_settings.world_setting or DEFAULT_WORLD_SETTING,
        world_setting_is_default=not user_settings.world_setting,
        my_gender=user_settings.my_gender,
        strip_variant=user_settings.strip_variant,
        model=settings.deepseek_model,
        daily_limit=settings.daily_message_limit,
        daily_used=count_today_messages(db, user.id),
    )


@router.get("")
def get_settings(user: UserDep, db: DbDep) -> SettingsOut:
    """返回当前用户的设置。"""
    return to_settings_out(db, user, db.get(UserSettings, user.id))


@router.patch("")
def patch_settings(body: SettingsPatch, user: UserDep, db: DbDep) -> SettingsOut:
    """只更新请求体里出现的字段。"""
    user_settings = db.get(UserSettings, user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user_settings, field, value)
    db.commit()
    return to_settings_out(db, user, user_settings)
