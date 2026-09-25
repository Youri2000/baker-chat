"""角色提示词路由：列出 29 个角色的生效提示词，保存 / 删除用户覆盖。"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.characters import CHARACTER_NAMES, CHARACTER_PROMPTS
from app.deps import DbDep, UserDep
from app.models import PromptOverride
from app.schemas import CharacterPromptOut, PromptPut

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.get("")
def list_prompts(user: UserDep, db: DbDep) -> list[CharacterPromptOut]:
    """按内置顺序返回 29 条提示词，覆盖值优先于内置值。"""
    overrides = {
        override.character_name: override.prompt
        for override in db.scalars(select(PromptOverride).where(PromptOverride.user_id == user.id))
    }
    return [
        CharacterPromptOut(
            character_name=name,
            prompt=overrides.get(name, CHARACTER_PROMPTS[name]),
            is_custom=name in overrides,
        )
        for name in CHARACTER_NAMES
    ]


@router.put("/{character_name}")
def put_prompt(
    character_name: str, body: PromptPut, user: UserDep, db: DbDep
) -> CharacterPromptOut:
    """保存覆盖；内容为空或与内置值相同时删除覆盖记录，回退到内置提示词。"""
    if character_name not in CHARACTER_PROMPTS:
        raise HTTPException(404, "角色不存在")
    override = db.scalar(
        select(PromptOverride).where(
            PromptOverride.user_id == user.id, PromptOverride.character_name == character_name
        )
    )
    # 与内置值两边都去掉首尾空白再比较：只多了末尾空格不算自定义
    prompt = body.prompt.strip()
    is_custom = bool(prompt) and prompt != CHARACTER_PROMPTS[character_name].strip()
    if not is_custom:
        # 空内容或与内置相同：删除已有覆盖，回退到内置提示词
        if override is not None:
            db.delete(override)
    elif override is not None:
        # 已有覆盖：原地更新
        override.prompt = body.prompt
    else:
        # 首次自定义：新建覆盖记录
        db.add(PromptOverride(user_id=user.id, character_name=character_name, prompt=body.prompt))
    db.commit()
    return CharacterPromptOut(
        character_name=character_name,
        prompt=body.prompt if is_custom else CHARACTER_PROMPTS[character_name],
        is_custom=is_custom,
    )
