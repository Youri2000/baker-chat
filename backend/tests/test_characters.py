"""内置常量迁移测试：29 个角色齐全且非空，并与原项目 TS 源文件逐字一致（源文件不存在则跳过）。"""

import re
from pathlib import Path

import pytest

from app.characters import (
    CHARACTER_NAMES,
    CHARACTER_PROMPTS,
    DEFAULT_WORLD_SETTING,
    FIXED_SYSTEM_PROMPT,
)

ORIGINAL_SRC = Path(__file__).resolve().parents[2] / "endfield-baker-chat" / "src"
needs_original = pytest.mark.skipif(
    not ORIGINAL_SRC.is_dir(), reason="原项目源码只在本机作为参考，CI 中不存在"
)


def test_prompts_cover_all_29_characters() -> None:
    """29 个角色名互不重复，每个都有非空提示词。"""
    assert len(CHARACTER_NAMES) == 29
    assert len(set(CHARACTER_NAMES)) == 29
    assert set(CHARACTER_PROMPTS) == set(CHARACTER_NAMES)
    assert all(CHARACTER_PROMPTS[name].strip() for name in CHARACTER_NAMES)


@needs_original
def test_names_match_character_ts() -> None:
    """角色顺序与原项目 CHARACTERS 数组一致。"""
    source = (ORIGINAL_SRC / "constants" / "character.ts").read_text(encoding="utf-8")
    array = source[source.index("export const CHARACTERS") :]
    array = array[: array.index("\n]")]
    assert re.findall(r"\{ name: '([^']+)'", array) == CHARACTER_NAMES


@needs_original
def test_prompts_match_prompts_ts() -> None:
    """JSON 里的提示词与原项目模板字符串逐字相同（用另一套解析器独立比对）。"""
    source = (ORIGINAL_SRC / "constants" / "prompts.ts").read_text(encoding="utf-8")
    # 源文件没有反斜杠转义与 ${} 插值，两个反引号之间就是原文
    assert "\\" not in source and "${" not in source
    parsed = dict(re.findall(r'^\s*"([^"]+)": `([^`]*)`,?$', source, re.MULTILINE))
    assert parsed == CHARACTER_PROMPTS


@needs_original
def test_system_prompt_and_world_setting_match_settings_ts() -> None:
    """固定系统提示词与默认世界观逐字来自原项目 settings.ts。"""
    source = (ORIGINAL_SRC / "stores" / "settings.ts").read_text(encoding="utf-8")

    def template(name: str) -> str:
        return re.search(rf"const {name} = `([^`]*)`", source).group(1)

    assert template("FIXED_SYSTEM_PROMPT") == FIXED_SYSTEM_PROMPT
    assert template("DEFAULT_WORLD_SETTING") == DEFAULT_WORLD_SETTING
