"""长会话种子数据：为聊天区性能度量（chat-perf.mjs）准备 100 / 500 / 2000 条固定的混合消息。

直接用后端自己的 SQLAlchemy 模型与 DATABASE_URL 写库，不走 HTTP：
先跑一遍 main.py 的 lifespan 启动阶段（建 SQLite 目录、建表、演示账号不存在则用 create_user 创建，
29 个角色各一段空会话），再把指定角色的第一段会话清空并写入 N 条消息。
消息双方交替成段（我方 1–2 条、对方 1–4 条），每条渲染为 1–4 行
（按气泡内宽 634px、约 30 个汉字一行估算；对方消息与持久化的 AI 回复一样不含换行），
约 20% 含 [sns_emoji_NNN] 表情，状态均为 completed。随机数种子固定，同一参数每次生成的内容完全相同；
重复运行只会重写这几段会话的消息，其他数据不动。结束时以 JSON 打印会话 id、角色名与统计。

复现（backend/.venv 里以可编辑方式装了后端，可直接 import app）：
    backend/.venv/bin/python scripts/measure/seed-messages.py --sizes 100:诀,500:卡缪,2000:弭弗
脚本在导入后端模块前先切到本仓库的 backend/ 目录，DATABASE_URL 里 sqlite:///./data/baker.db
这类相对路径与在 backend/ 下启动后端时指向同一个文件，从哪个目录运行脚本都一样。
DATABASE_URL 与要测的后端一致，未设置时从 backend/.env 读取；
JWT_SECRET 只需有值让 Settings() 能加载，种子脚本不签发 token，不必与后端一致。
要写入另一份后端代码的库时，用 PYTHONPATH 指向那份 backend/，并把 DATABASE_URL 设成绝对路径。
ruff 在 backend/ 下运行，app 才会被识别为本项目的包。
"""

import argparse
import asyncio
import json
import os
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select

# 导入后端模块前切到 backend/：相对的 SQLite 路径按后端的启动目录解析，而不是运行脚本时的目录
os.chdir(Path(__file__).resolve().parents[2] / "backend")

from app.characters import CHARACTER_NAMES  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app, lifespan  # noqa: E402
from app.models import Conversation, Message, User  # noqa: E402

SEED = 20260928
EMOJI_COUNT = 37
EMOJI_RATIO = 0.2
CHARS_PER_LINE = 30  # 气泡内宽 634px ÷ 字号 20.88px
LINE_WEIGHTS = {1: 45, 2: 30, 3: 15, 4: 10}  # 每条消息的渲染行数分布
START = datetime(2026, 9, 1, tzinfo=UTC)

SENTENCES = [
    "今天的工作报告已经整理好了，请管理员过目",
    "明白，我会按照你说的去做",
    "外面的风好大，记得多穿一件衣服",
    "这批物资需要在傍晚之前送到前线据点",
    "我刚才去看了看工坊，大家都在忙",
    "你觉得这个方案可行吗",
    "嗯",
    "好的",
    "收到",
    "等一下，我再确认一遍坐标",
    "如果遇到源石虫群，先撤退到安全区再说",
    "昨晚的巡逻记录里有一段异常信号，我把它标出来了",
    "管理员，你已经连续工作很久了，休息一下吧",
    "这个问题我也想了很久，还是没有头绪",
    "终于修好了，试运行一切正常",
    "谢谢你一直以来的照顾",
    "下次一起去看看那片湖吧，听说傍晚的时候特别漂亮",
    "我把新的配方写在笔记本第三页了",
    "哈哈，你说得对",
    "唔……让我想想",
]
PUNCTUATION = ["，", "。", "！", "？", "……"]


def parse_size(value: str) -> tuple[int, str]:
    """把 "2000:弭弗" 解析成 (条数, 角色名)；角色必须是 29 个内置角色之一。"""
    count, _, name = value.partition(":")
    if name not in CHARACTER_NAMES or not count.isdigit():
        raise argparse.ArgumentTypeError(f"格式应为 条数:内置角色名，收到 {value!r}")
    return int(count), name


def paragraph(rng: random.Random, lines: int) -> str:
    """拼一段不含换行、按气泡宽度折行后正好 lines 行的文本。"""
    low = 2 if lines == 1 else (lines - 1) * CHARS_PER_LINE + 4
    target = rng.randint(low, lines * CHARS_PER_LINE - 2)
    text = ""
    while len(text) < target:
        text += rng.choice(SENTENCES) + rng.choice(PUNCTUATION)
    return text[:target]


def message_text(rng: random.Random, side: str) -> str:
    """✅ 生成一条消息：1–4 行，我方多行时有一半用显式换行，约 20% 插入 1–3 个表情 token。"""
    lines = rng.choices(list(LINE_WEIGHTS), weights=list(LINE_WEIGHTS.values()))[0]
    if side == "mine" and lines > 1 and rng.random() < 0.5:
        text = "\n".join(paragraph(rng, 1) for _ in range(lines))
    else:
        text = paragraph(rng, lines)
    if rng.random() < EMOJI_RATIO:
        pos = rng.randint(0, len(text))
        tokens = "".join(
            f"[sns_emoji_{rng.randint(1, EMOJI_COUNT):03d}]" for _ in range(rng.randint(1, 3))
        )
        text = text[:pos] + tokens + text[pos:]
    return text


def build_rows(count: int) -> list[tuple[str, str]]:
    """按固定种子生成 count 条 (side, text)：我方 1–2 条、对方 1–4 条交替成段。"""
    rng = random.Random(SEED + count)
    rows: list[tuple[str, str]] = []
    side = "mine"
    while len(rows) < count:
        run = rng.randint(1, 2) if side == "mine" else rng.randint(1, 4)
        rows.extend((side, message_text(rng, side)) for _ in range(min(run, count - len(rows))))
        side = "other" if side == "mine" else "mine"
    return rows


def seed_conversation(user_id: int, name: str, count: int) -> dict[str, object]:
    """清空该角色第一段会话的消息并写入 count 条，返回会话 id 与统计。"""
    rows = build_rows(count)
    with SessionLocal() as db:
        conversation_id = db.scalar(
            select(Conversation.id)
            .where(Conversation.user_id == user_id, Conversation.character_name == name)
            .order_by(Conversation.id)
        )
        db.execute(delete(Message).where(Message.conversation_id == conversation_id))
        db.add_all(
            Message(
                conversation_id=conversation_id,
                side=side,
                text=text,
                status="completed",
                created_at=START + timedelta(seconds=30 * i),
            )
            for i, (side, text) in enumerate(rows)
        )
        db.commit()
    return {
        "character": name,
        "conversation_id": conversation_id,
        "messages": count,
        "mine": sum(1 for side, _ in rows if side == "mine"),
        "with_emoji": sum(1 for _, text in rows if "[sns_emoji_" in text),
        "with_newline": sum(1 for _, text in rows if "\n" in text),
        "avg_chars": round(sum(len(text) for _, text in rows) / count, 1),
    }


async def run_startup() -> None:
    """跑一遍后端 lifespan 的启动阶段，与 uvicorn 启动时建表、建演示账号的逻辑完全相同。"""
    async with lifespan(app):
        pass


def main() -> None:
    """解析参数、准备演示账号、写入各段会话并打印 JSON。"""
    parser = argparse.ArgumentParser(description="为聊天区性能度量写入固定的长会话消息")
    parser.add_argument(
        "--sizes",
        type=lambda value: [parse_size(item) for item in value.split(",")],
        default="100:诀,500:卡缪,2000:弭弗",
        help="逗号分隔的 条数:角色名，每个角色用它的第一段会话",
    )
    args = parser.parse_args()

    asyncio.run(run_startup())
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.username == settings.demo_username))
    conversations = [seed_conversation(user_id, name, count) for count, name in args.sizes]
    result = {"username": settings.demo_username, "conversations": conversations}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
