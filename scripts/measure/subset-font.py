"""字体子集化：把 4.32 MB 的 HarmonyOS Sans SC Medium 全量字体裁成项目实际需要的字符集。

字符集 = ASCII 可打印 + GB2312 常用标点/全角符号（A1、A3 区）+ GB2312 一、二级汉字（6763 字）
+ 前端源码与 index.html 里出现的全部字符（UI 文案、29 个角色名）
+ backend/app/characters.py 与 character_prompts.json 里的全部字符（角色提示词中的生僻字）。
字体没有的字符（如 emoji）由 fontTools 自动跳过；不在子集里的生僻字在浏览器中回退到系统字体。

复现（需要 fonttools + brotli，例如在临时 venv 里 `pip install fonttools brotli`）：
    python scripts/measure/subset-font.py <原字体.woff2> <输出.woff2>
    原字体：endfield-baker-chat/src/assets/fonts/HarmonyOS_Sans_SC_Medium.woff2
    输出：  frontend/src/assets/fonts/HarmonyOS_Sans_SC_Medium.subset.woff2
原字体保留在只读的原项目目录 endfield-baker-chat/src/assets/fonts/ 中，前端只提交子集文件。
"""

import argparse
import gzip
from pathlib import Path

import brotli
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]

# 参与字符统计的文本来源（相对仓库根目录）
TEXT_SOURCES = [
    "frontend/index.html",
    "backend/app/characters.py",
    "backend/app/data/character_prompts.json",
]
FRONTEND_GLOBS = ["frontend/src/**/*.ts", "frontend/src/**/*.tsx", "frontend/src/**/*.css"]


def gb2312_chars() -> set[str]:
    """GB2312 的 A1 区（标点符号）、A3 区（全角 ASCII）与 B0–F7 区（一、二级汉字）。"""
    chars: set[str] = set()
    for high in (0xA1, 0xA3, *range(0xB0, 0xF8)):
        for low in range(0xA1, 0xFF):
            try:
                chars.add(bytes([high, low]).decode("gb2312"))
            except UnicodeDecodeError:
                continue  # 区位表中的空位
    return chars


def project_chars() -> set[str]:
    """前端源码、index.html、后端角色数据里出现的全部字符（含注释，属于安全的超集）。"""
    paths = [ROOT / p for p in TEXT_SOURCES]
    for pattern in FRONTEND_GLOBS:
        paths.extend(ROOT.glob(pattern))
    chars: set[str] = set()
    for path in paths:
        chars.update(path.read_text(encoding="utf-8"))
    return chars


def collect_text() -> str:
    """✅ 合并三部分字符并去重，得到交给 subsetter 的文本。"""
    ascii_printable = {chr(code) for code in range(0x20, 0x7F)}
    return "".join(sorted(ascii_printable | gb2312_chars() | project_chars()))


def compressed_sizes(data: bytes) -> tuple[int, int]:
    """返回 gzip -9 与 brotli 压缩后的字节数（woff2 本身已是 brotli，二者只会略小或持平）。"""
    return len(gzip.compress(data, compresslevel=9)), len(brotli.compress(data))


def describe(path: Path) -> str:
    """一行统计：文件大小、压缩后大小、字形数、cmap 字符数。"""
    data = path.read_bytes()
    font = TTFont(path)
    gz, br = compressed_sizes(data)
    return (
        f"{path.name}: {len(data):,} B (gzip {gz:,} B, brotli {br:,} B), "
        f"glyphs {len(font.getGlyphOrder()):,}, cmap {len(font.getBestCmap()):,}"
    )


def main() -> None:
    """解析参数、生成子集并打印前后对比。"""
    parser = argparse.ArgumentParser(description="生成 HarmonyOS Sans SC Medium 的项目字符子集")
    parser.add_argument("source", type=Path, help="原始 woff2 字体路径")
    parser.add_argument("output", type=Path, help="子集 woff2 输出路径")
    args = parser.parse_args()

    text = collect_text()
    options = subset.Options(flavor="woff2")
    font = subset.load_font(str(args.source), options)
    cmap = font.getBestCmap()
    missing = [c for c in text if ord(c) not in cmap and not c.isspace()]
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(args.output), options)

    print(f"requested chars: {len(text):,}; not in font (skipped): {''.join(missing) or '-'}")
    print("before  " + describe(args.source))
    print("after   " + describe(args.output))


if __name__ == "__main__":
    main()
