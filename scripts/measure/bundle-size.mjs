/**
 * @file 产物体积对比：把原 Vue 版（endfield-baker-chat/dist）与 React 版（frontend/dist）的构建产物
 * 按 JS / CSS / 字体 / 图片 / HTML 分类，统计原始字节与 gzip 字节（Node zlib 默认级别，与 Vite 构建报告一致），
 * 以 Markdown 表格输出到 stdout；第二张表列出两边的 JS / CSS / 字体文件明细。
 * 复现（先各自构建好 dist）：node scripts/measure/bundle-size.mjs [--old endfield-baker-chat/dist] [--new frontend/dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');

/** 扩展名 → 类别；不在表里的扩展名归入"其他" */
const CATEGORY_BY_EXT = {
  '.js': 'JS',
  '.css': 'CSS',
  '.woff2': '字体',
  '.woff': '字体',
  '.ttf': '字体',
  '.webp': '图片',
  '.png': '图片',
  '.jpg': '图片',
  '.svg': '图片',
  '.ico': '图片',
  '.html': 'HTML',
};
const CATEGORIES = ['JS', 'CSS', '字体', '图片', 'HTML', '其他', '合计'];

/** 递归列出目录下全部文件 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** 单个文件的原始与 gzip 字节数 */
function measure(path) {
  const data = readFileSync(path);
  return { raw: data.length, gzip: gzipSync(data).length };
}

/** 统计一个 dist：按类别汇总（含合计）以及每个文件的明细 */
function summarize(dir) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, { raw: 0, gzip: 0, files: 0 }]));
  const files = walk(dir).map((path) => {
    const size = measure(path);
    const category = CATEGORY_BY_EXT[extname(path).toLowerCase()] ?? '其他';
    for (const key of [category, '合计']) {
      totals[key].raw += size.raw;
      totals[key].gzip += size.gzip;
      totals[key].files += 1;
    }
    return { name: relative(dir, path), category, ...size };
  });
  return { totals, files };
}

/** 字节数 → 以 KB 为单位保留一位小数 */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 带符号的差值与百分比，如 "-3311.5 KB (-78.5%)" */
function delta(before, after) {
  if (before === 0) return '—';
  const diff = after - before;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${kb(diff)} (${sign}${((diff / before) * 100).toFixed(1)}%)`;
}

/** Markdown 表格行 */
function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

/** 解析参数、统计两边并打印两张表 */
function main() {
  const { values } = parseArgs({
    options: {
      old: { type: 'string', default: 'endfield-baker-chat/dist' },
      new: { type: 'string', default: 'frontend/dist' },
    },
  });
  const oldDir = resolve(ROOT, values.old);
  const newDir = resolve(ROOT, values.new);
  statSync(oldDir);
  statSync(newDir);
  const before = summarize(oldDir);
  const after = summarize(newDir);

  console.log(`原 Vue 版：${values.old}（${before.totals['合计'].files} 个文件）`);
  console.log(`React 版：${values.new}（${after.totals['合计'].files} 个文件）\n`);
  console.log(
    row(['类别', 'Vue 版原始', 'Vue 版 gzip', 'React 版原始', 'React 版 gzip', '原始差值']),
  );
  console.log(row(['---', '---', '---', '---', '---', '---']));
  for (const category of CATEGORIES) {
    const b = before.totals[category];
    const a = after.totals[category];
    if (b.files === 0 && a.files === 0) continue;
    console.log(row([category, kb(b.raw), kb(b.gzip), kb(a.raw), kb(a.gzip), delta(b.raw, a.raw)]));
  }

  console.log('\n主要文件明细（JS / CSS / 字体）：\n');
  console.log(row(['版本', '文件', '原始', 'gzip']));
  console.log(row(['---', '---', '---', '---']));
  for (const [label, summary] of [
    ['Vue', before],
    ['React', after],
  ]) {
    for (const file of summary.files.filter((f) => ['JS', 'CSS', '字体'].includes(f.category))) {
      console.log(row([label, file.name, kb(file.raw), kb(file.gzip)]));
    }
  }
}

main();
