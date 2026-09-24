/**
 * @file 文档检查（`pnpm check:docs`）：核对源码注释里的 `docs/interview.md#<slug>` 锚点在文档中有对应标题，
 * 以及 README.md、docs/*.md、docs/notes/*.md 里的相对链接与反引号包住的仓库内路径真实存在。
 * 只用 Node 内置模块，只读；发现问题时逐条打印 `文件:行号  说明` 并以退出码 1 结束。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INTERVIEW = 'docs/interview.md';
/** 扫描锚点的源码后缀（JSON 与 Markdown 不算源码：前者不写注释，后者由文档检查覆盖） */
const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
]);
/** 不进入的目录：依赖、产物、参考旧项目、Comet 状态与工具缓存 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.venv',
  '__pycache__',
  '.comet',
  '.codegraph',
  '.ruff_cache',
  '.pytest_cache',
  'test-results',
  'playwright-report',
  '.tmp',
  'endfield-baker-chat',
  'yuan-Chat',
]);
/** 文档里可以提到但不在仓库内的路径：本地文件、忽略的产物、只在本机的参考项目（以 / 结尾表示前缀） */
const EXTERNAL_ALLOWLIST = [
  'endfield-baker-chat/',
  'yuan-Chat/',
  'backend/.env',
  'frontend/.env',
  'backend/.venv/',
  'backend/data/',
  'frontend/dist',
  'e2e/.tmp/',
];
/** 仓库根目录的直接子项；反引号里的路径只有以其中之一开头才当作仓库内路径 */
const ROOT_ENTRIES = new Set(readdirSync(ROOT));

/** 把 ``` 围栏代码块内的行替换为空行（保留行号），链接、路径与标题都不在代码块里找 */
function blankFences(text) {
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
}

/** GitHub 标题 id：小写，去掉字母 / 数字 / 空格 / 连字符以外的字符，空格换成连字符 */
function slugify(heading) {
  const text = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只保留可见文字
    .replace(/`/g, '');
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** 一个 Markdown 文件的全部标题 id；重复标题按 GitHub 规则依次加 -1、-2 */
function headingIds(lines) {
  const ids = new Set();
  const seen = new Map();
  for (const line of lines) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m === null) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n === 0 ? base : `${base}-${n}`);
  }
  return ids;
}

/** 递归列出源码文件（仓库相对路径） */
function sourceFiles(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && rel !== 'docs/comet') sourceFiles(abs, out);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(rel);
    }
  }
  return out;
}

/** 要检查的文档：README.md 与 docs/、docs/notes/ 下的 Markdown */
function docFiles() {
  const inDir = (dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.posix.join(dir, name));
  return ['README.md', ...inDir('docs'), ...inDir('docs/notes')];
}

/** 是否属于允许不存在的仓库外引用 */
function isAllowlisted(rel) {
  return EXTERNAL_ALLOWLIST.some((item) =>
    item.endsWith('/') ? rel.startsWith(item) : rel === item,
  );
}

/** 已读文档的缓存：去掉代码块后的行与标题 id */
const docCache = new Map();

/** 读取一个文档（带缓存），同一文件被多处链接时只解析一次 */
function loadDoc(rel) {
  let doc = docCache.get(rel);
  if (doc === undefined) {
    const lines = blankFences(readFileSync(path.join(ROOT, rel), 'utf8'));
    doc = { lines, ids: headingIds(lines) };
    docCache.set(rel, doc);
  }
  return doc;
}

/**
 * 核对一个仓库内目标（可带 #fragment）是否存在；目标 Markdown 带锚点时再核对标题。
 * 返回问题描述，没有问题时返回 null。
 */
function checkTarget(rel, fragment, mustBeDir) {
  if (isAllowlisted(rel)) return null;
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return `目标不存在: ${rel}`;
  if (mustBeDir && !statSync(abs).isDirectory()) return `不是目录: ${rel}/`;
  if (fragment !== null && rel.endsWith('.md') && !loadDoc(rel).ids.has(fragment)) {
    return `锚点 #${fragment} 在 ${rel} 中没有对应标题`;
  }
  return null;
}

/** 源码注释里每个指向 docs/interview.md 的锚点都要有对应标题 */
function checkSourceAnchors(problems, stats) {
  const ids = loadDoc(INTERVIEW).ids;
  for (const rel of sourceFiles()) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/docs\/interview\.md#([\w-]+)/g)) {
        stats.anchors += 1;
        if (!ids.has(m[1]))
          problems.push(`${rel}:${i + 1}  锚点 #${m[1]} 在 ${INTERVIEW} 中没有对应标题`);
      }
    });
  }
}

/** 文档里的相对链接（含图片）与反引号包住的仓库内路径 */
function checkDoc(rel, problems, stats) {
  const { lines } = loadDoc(rel);
  const dir = path.posix.dirname(rel);
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    // 相对链接：跳过带协议的外链；#frag 指向本文件
    for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      stats.links += 1;
      const [file, fragment = null] = target.split('#');
      const targetRel = file === '' ? rel : path.posix.normalize(path.posix.join(dir, file));
      const problem = checkTarget(targetRel, fragment, false);
      if (problem !== null) problems.push(`${where}  链接 ${target}：${problem}`);
    }
    // 反引号路径：只看形如 a/b/c 且以仓库根下已有条目开头的（`lib/http.ts` 这类相对某个子目录的简写不检查）
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1];
      if (!/^[\w.@-][\w.@\-/#]*$/.test(token) || token.startsWith('/')) continue;
      const [file, fragment = null] = token.split('#');
      if (!ROOT_ENTRIES.has(file.split('/')[0])) continue;
      stats.paths += 1;
      const problem = checkTarget(file.replace(/\/$/, ''), fragment, file.endsWith('/'));
      if (problem !== null) problems.push(`${where}  \`${token}\`：${problem}`);
    }
  });
}

/** 入口：汇总问题并设置退出码 */
function main() {
  const problems = [];
  const stats = { anchors: 0, links: 0, paths: 0 };
  checkSourceAnchors(problems, stats);
  for (const rel of docFiles()) checkDoc(rel, problems, stats);
  const summary = `源码锚点 ${stats.anchors} 处、文档链接 ${stats.links} 个、反引号路径 ${stats.paths} 个`;
  if (problems.length === 0) {
    console.log(`文档检查通过：${summary}`);
    return;
  }
  console.error(`文档检查发现 ${problems.length} 个问题（${summary}）：`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}

main();
