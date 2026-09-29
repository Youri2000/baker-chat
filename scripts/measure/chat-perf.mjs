/**
 * @file 长会话聊天区性能：用 Playwright 打开 seed-messages.py 写好的长会话，按"会话条数 × CPU 降速倍率"
 * （CDP Emulation.setCPUThrottlingRate）各跑 --runs 次，输出中位数与每次的原始值：
 *   1. 打开会话耗时：先打开一段空会话让消息区挂载，再点击目标子卡，到最后一条消息画出来为止——
 *      聊天滚动容器里最后一个气泡的文字就是会话最后一条消息、已可见且气泡盖住整段文字、容器停在底部 2px 内，再等一帧；
 *   2. 这次打开拉取的消息 JSON 字节数：接口与页面跨域且没有 Timing-Allow-Origin，Resource Timing 读到的大小是 0，
 *      改用 CDP Network 事件取响应体字节与含响应头的传输字节（loadingFinished.encodedDataLength）；
 *   3. 加载全部历史后的元素数：整页、聊天滚动容器内的元素数与 DOM 中的消息行数；分页列表会反复滚到顶部，
 *      直到 1 秒内没有新的消息请求、没有加载气泡、内容高度不再变化（完整列表打开时已全部加载），
 *      目标会话加载到的不同消息 id 少于种子条数时直接报错；"DOM 节点数少 90%"的验收看"聊天区元素"一列
 *      （滚动容器内 getElementsByTagName('*') 的数量），不看整页元素数或 CDP 的 DOM 节点数；
 *   4. 滚动流畅度：回到底部后用鼠标滚轮按固定步长从底滚到顶（只测这一个方向），期间用 requestAnimationFrame 采样帧间隔，
 *      统计 p50 / p95 / 最大值、超过 20 / 33 ms 的帧数、Long Animation Frames，以及滚动中 DOM 里气泡数的最大值；
 *      上下往返滚动后 DOM 中不超过 60 行的检查在 e2e/tests/scroll.spec.ts；
 *   5. GC 后的 JS 堆与 CDP 统计的 DOM 节点数。
 * 聊天滚动容器按 `.animate-chat-in.scroll-mask` 查找，消息行按气泡（排除 role=status 的加载气泡）计数，
 * 完整渲染、虚拟化与分页的列表都用同一套判定。
 * --lazy 模式改测首屏按需加载（新上下文、禁用缓存）：/login 与已登录打开 / 时入口 JS（index.html 里
 * <script type="module"> 指向的文件）的传输字节与 gzip 字节、全部 JS 请求的合计（含预取的 chunk）与明细
 * （开始 / 结束时间、传输字节、gzip 字节）、/me 请求开始时间、已登录 / 时 ChatPage chunk 的开始时间及它减去
 * /me 开始时间的差值、导航开始到聊天页挂载（设置按钮与 29 张主卡都已渲染）、空闲后打开设置弹窗的耗时，
 * 以及登录页点击"登录"到聊天页挂载的耗时；--network slow4g 叠加慢速 4G 限速。
 * --typing 模式改测 AI 回复显示期间的帧时长（需要后端 AI_MOCK=1）：在 --typing-character 角色的第一段会话里，
 * 分别以打字机开启与关闭（经 PATCH /api/settings 切换）、各 CPU 降速倍率发送一条消息，从按下 Enter 到回复全部显示
 * （停止按钮换回发送按钮）全程用 requestAnimationFrame 采样帧间隔，输出回复耗时、帧 p50 / p95 / 最大值、超过 20 / 33 ms
 * 的帧数与 Long Animation Frames；结束后清空该会话的消息与上下文，并把打字机开关恢复为测量前的值。
 * 结果写入 --out 指定的 JSON 文件，Markdown 表格输出到 stdout，进度输出到 stderr。
 * 依赖 e2e 工作区安装的 @playwright/test 与它的 Chromium。
 * 复现（前端以 VITE_API_BASE_URL 指向后端构建后用 vite preview 启动；后端已用 seed-messages.py 写好数据，
 * 且 CORS_ORIGINS 包含 --base 的源，否则页面发出的跨域请求全部失败）：
 *   node scripts/measure/chat-perf.mjs --base http://127.0.0.1:5781 --api http://127.0.0.1:8781 \
 *     --sizes 100:诀,500:卡缪,2000:弭弗 --cpu 1,4 --runs 5 --out chat-perf.json
 *   node scripts/measure/chat-perf.mjs --lazy --base http://127.0.0.1:5781 --api http://127.0.0.1:8781 \
 *     --runs 5 --network none --out chat-perf-lazy.json
 *   node scripts/measure/chat-perf.mjs --typing --base http://127.0.0.1:5781 --api http://127.0.0.1:8781 \
 *     --cpu 1,4 --runs 5 --out chat-perf-typing.json
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

// Playwright 只在 e2e 工作区安装，从那里解析而不是再装一份
const { chromium } = createRequire(new URL('../../e2e/package.json', import.meta.url))(
  '@playwright/test',
);

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:5173' },
    api: { type: 'string', default: 'http://localhost:8000' },
    user: { type: 'string', default: 'demo' },
    password: { type: 'string', default: 'demo123' },
    sizes: { type: 'string', default: '100:诀,500:卡缪,2000:弭弗' },
    empty: { type: 'string', default: '梨诺' },
    cpu: { type: 'string', default: '1,4' },
    runs: { type: 'string', default: '5' },
    'wheel-step': { type: 'string', default: '300' },
    lazy: { type: 'boolean', default: false },
    typing: { type: 'boolean', default: false },
    'typing-character': { type: 'string', default: '洛茜' },
    network: { type: 'string', default: 'none' },
    out: { type: 'string', default: 'chat-perf.json' },
  },
});

/** 聊天滚动容器：消息区根元素同时带入场动画与渐隐遮罩（左侧角色列表只有遮罩） */
const SCROLLER = '.animate-chat-in.scroll-mask';
/** 消息气泡的底色矩形；加载气泡的 svg 带 role=status，不算消息行 */
const BUBBLE_RECTS =
  'svg:not([role="status"]) > rect.fill-bubble-mine, svg:not([role="status"]) > rect.fill-bubble-other';
/** 消息列表接口，分页参数可有可无 */
const MESSAGES_URL = /\/api\/conversations\/\d+\/messages(\?|$)/;
const VIEWPORT = { width: 1920, height: 1080 };
/** 网络限速档位；slow4g 取 Lighthouse 慢速 4G 的参数：RTT 150ms、下行 1.6 Mbps、上行 750 Kbps */
const NETWORK = {
  none: null,
  slow4g: { latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 },
};

/** 调后端 JSON 接口 */
async function api(method, path, token, body) {
  const res = await fetch(`${args.api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** 中位数 */
function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 保留一位小数 */
function round1(x) {
  return Math.round(x * 10) / 10;
}

/** 对每次运行结果的数值字段（含一层嵌套对象）逐项取中位数 */
function medianOf(rows) {
  const out = {};
  for (const [key, value] of Object.entries(rows[0])) {
    if (typeof value === 'number') out[key] = round1(median(rows.map((r) => r[key])));
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = medianOf(rows.map((r) => r[key]));
    }
  }
  return out;
}

/** Markdown 表格行 */
function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

/** 字节数 → KB，保留一位小数 */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 在 CDP 会话上记录消息列表请求：响应体字节、传输字节与返回的消息 id（兼容数组与 {items} 两种响应） */
async function trackMessages(cdp) {
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request.method === 'GET' && MESSAGES_URL.test(request.url)) {
      requests.set(requestId, {
        url: request.url,
        finished: null,
        bodyBytes: 0,
        transferBytes: 0,
        ids: [],
      });
    }
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const entry = requests.get(requestId);
    if (entry === undefined) return;
    entry.transferBytes = encodedDataLength;
    entry.finished = cdp.send('Network.getResponseBody', { requestId }).then(({ body }) => {
      const data = JSON.parse(body);
      entry.bodyBytes = Buffer.byteLength(body);
      entry.ids = (Array.isArray(data) ? data : data.items).map((m) => m.id);
    });
  });
  cdp.on('Network.loadingFailed', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (entry !== undefined) entry.finished = Promise.resolve();
  });
  await cdp.send('Network.enable');
  return requests;
}

/** 还没结束的消息请求数 */
function pendingCount(requests) {
  return [...requests.values()].filter((r) => r.finished === null).length;
}

/** 等给定的消息请求全部结束并取完响应体 */
async function settleRequests(entries) {
  while (entries.some((r) => r.finished === null)) await new Promise((r) => setTimeout(r, 20));
  await Promise.all(entries.map((r) => r.finished));
}

/** 展开角色主卡（已展开则不动），返回它下面的第一张会话子卡 */
async function firstSubCard(page, name) {
  const main = page.getByRole('button', { name, exact: true });
  await main.waitFor({ state: 'attached' });
  // 主卡与子卡是零尺寸容器，Playwright 认为不可见，用 dispatchEvent 触发 React 的委托点击
  if ((await main.getAttribute('data-collapsed')) !== null) await main.dispatchEvent('click');
  // 卡片块里第 0 个 role=button 是主卡自己，之后按顺序是子卡
  const sub = main.locator('xpath=..').locator('[role="button"]').nth(1);
  await sub.waitFor({ state: 'attached' });
  return sub;
}

/**
 * 页面内：点击子卡后逐帧检查，最后一条消息画出来后再等一帧，返回点击到此刻的毫秒数；30 秒未就绪返回 null。
 * ⚠️ 先判断是否贴底再查气泡：未贴底时不必遍历气泡；每帧读 scrollHeight 只是把本帧本来就要做的布局提前，不额外增加工作量
 */
function openConversation([subCard, lastText, scrollerSel, bubbleSel]) {
  /** 最后一个气泡是否已是会话最后一条消息、按真实尺寸可见，且容器停在底部 */
  const ready = () => {
    const scroller = document.querySelector(scrollerSel);
    if (scroller === null) return false;
    if (Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) > 2) {
      return false;
    }
    const rects = scroller.querySelectorAll(bubbleSel);
    const rect = rects[rects.length - 1];
    if (rect === undefined) return false;
    const svg = rect.ownerSVGElement;
    const text = svg.querySelector('foreignObject > div');
    if (text.textContent !== lastText || getComputedStyle(svg).visibility !== 'visible') {
      return false;
    }
    // 气泡矩形盖住整段文字，说明已按测量结果画出而不是加载占位尺寸
    const box = rect.getBoundingClientRect();
    const textBox = text.getBoundingClientRect();
    return box.width >= textBox.width && box.height >= textBox.height;
  };
  return new Promise((resolve) => {
    const t0 = performance.now();
    subCard.click();
    /** 每帧检查一次 */
    const check = () => {
      if (ready()) requestAnimationFrame(() => resolve(performance.now() - t0));
      else if (performance.now() - t0 > 30_000) resolve(null);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** 页面内：把聊天滚动容器滚到顶部，返回内容高度与是否有加载气泡 */
function scrollToTop(scrollerSel) {
  const scroller = document.querySelector(scrollerSel);
  scroller.scrollTop = 0;
  return `${scroller.scrollHeight}|${scroller.querySelector('[role="status"]') !== null}`;
}

/** 页面内：把聊天滚动容器滚到底部 */
function scrollToBottom(scrollerSel) {
  const scroller = document.querySelector(scrollerSel);
  scroller.scrollTop = scroller.scrollHeight;
}

/**
 * 反复滚到顶部触发分页加载，直到连续 1 秒内容高度、加载气泡、消息请求数都没有变化且没有进行中的请求；
 * 返回这一阶段新发出的消息请求
 */
async function loadAllHistory(page, requests) {
  const before = new Set(requests.keys());
  const started = Date.now();
  let quietSince = Date.now();
  let last = '';
  while (Date.now() - quietSince < 1000) {
    const state = `${await page.evaluate(scrollToTop, SCROLLER)}|${requests.size}`;
    if (state !== last || state.includes('|true|') || pendingCount(requests) > 0) {
      quietSince = Date.now();
      last = state;
    }
    if (Date.now() - started > 180_000) throw new Error('3 分钟内没有加载完全部历史');
    await page.waitForTimeout(100);
  }
  const added = [...requests].filter(([id]) => !before.has(id)).map(([, entry]) => entry);
  await settleRequests(added);
  return added;
}

/** 页面内：开始逐帧采样帧间隔、Long Animation Frames 与聊天区气泡数 */
function startFrameSampler(scrollerSel) {
  const scroller = document.querySelector(scrollerSel);
  // 活的 HTMLCollection：DOM 不变时 length 走缓存，每帧读取不给完整列表增加负担
  const svgs = scroller.getElementsByTagName('svg');
  const sampler = { scroller, deltas: [], loafs: [], rowsMax: 0, running: true };
  sampler.observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) sampler.loafs.push([e.duration, e.blockingDuration]);
  });
  sampler.observer.observe({ type: 'long-animation-frame' });
  let last = 0;
  /** 记录与上一帧的间隔 */
  const tick = (t) => {
    if (last !== 0) sampler.deltas.push(t - last);
    last = t;
    sampler.rowsMax = Math.max(sampler.rowsMax, svgs.length);
    if (sampler.running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__chatPerf = sampler;
}

/** 页面内：等下一帧，返回聊天滚动容器的 scrollTop */
function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => resolve(window.__chatPerf.scroller.scrollTop)),
  );
}

/** 页面内：停止采样并汇总帧间隔分位数与长帧统计 */
function stopFrameSampler() {
  const sampler = window.__chatPerf;
  sampler.running = false;
  sampler.observer.disconnect();
  const sorted = [...sampler.deltas].sort((a, b) => a - b);
  /** 最近秩分位数 */
  const pct = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    frames: sorted.length,
    p50: pct(0.5),
    p95: pct(0.95),
    max: sorted[sorted.length - 1],
    over20: sorted.filter((d) => d > 20).length,
    over33: sorted.filter((d) => d > 33).length,
    loafCount: sampler.loafs.length,
    loafMax: sampler.loafs.reduce((m, [d]) => Math.max(m, d), 0),
    loafBlocking: sampler.loafs.reduce((s, [, b]) => s + b, 0),
    rowsMax: sampler.rowsMax,
  };
}

/** ✅ 鼠标停在聊天区中央，每帧向上滚一个固定步长直到顶部，返回帧统计 */
async function wheelToTop(page, step) {
  const box = await page.locator(SCROLLER).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(startFrameSampler, SCROLLER);
  const started = Date.now();
  let top = Infinity;
  let steps = 0;
  let stuck = 0;
  while (top > 0) {
    await page.mouse.wheel(0, -step);
    const next = await page.evaluate(nextFrame);
    stuck = next === top ? stuck + 1 : 0;
    if (stuck > 60) throw new Error(`滚轮滚动停在 scrollTop=${top}，鼠标可能不在聊天区上`);
    top = next;
    steps += 1;
  }
  const frames = await page.evaluate(stopFrameSampler);
  return { ...frames, steps, durationMs: Date.now() - started };
}

/** ✅ 一次完整测量：打开会话 → 加载全部历史 → 回到底部数元素 → 滚轮滚到顶 */
async function measureRun(browser, token, size, cpu) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript((jwt) => localStorage.setItem('baker.token', jwt), token);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests = await trackMessages(cdp);
  try {
    await page.goto(`${args.base}/`);
    // 先打开空会话让消息区挂载，测的是"从一段会话切到长会话"
    await (await firstSubCard(page, args.empty)).dispatchEvent('click');
    await page.locator(SCROLLER).waitFor({ state: 'attached' });
    // 气泡字体只在用到时才下载，先全部加载完，避免测量途中换字体重排
    await page.evaluate(() => Promise.all([...document.fonts].map((font) => font.load())));
    const sub = await firstSubCard(page, size.name);
    await page.waitForTimeout(400); // 子卡下落动画 0.25s
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

    const before = new Set(requests.keys());
    /** 只留目标会话的消息请求，不混入先打开的空会话 */
    const ofTarget = (entries) =>
      entries.filter((r) => r.url.includes(`/conversations/${size.conversationId}/messages`));
    const lastText = size.lastText.replace(/\[sns_emoji_\d{3}\]/g, '');
    const openMs = await page.evaluate(openConversation, [
      await sub.elementHandle(),
      lastText,
      SCROLLER,
      BUBBLE_RECTS,
    ]);
    if (openMs === null) throw new Error(`${size.n} 条会话 30 秒内没有显示到最后一条消息`);
    const opened = ofTarget(
      [...requests].filter(([id]) => !before.has(id)).map(([, entry]) => entry),
    );
    await settleRequests(opened);
    await page.waitForTimeout(800); // 入场动画 0.3s 与尺寸过渡结束

    const history = ofTarget(await loadAllHistory(page, requests));
    const ids = new Set([...opened, ...history].flatMap((r) => r.ids));
    if (ids.size < size.n) {
      throw new Error(`${size.n} 条会话只加载到 ${ids.size} 条消息，检查种子数据与分页加载`);
    }
    // 虚拟列表跳到底部后才量出真实行高，总高度会变，等一会儿再贴一次底
    await page.evaluate(scrollToBottom, SCROLLER);
    await page.waitForTimeout(500);
    await page.evaluate(scrollToBottom, SCROLLER);
    await page.waitForTimeout(300);
    const dom = await page.evaluate(
      ([scrollerSel, bubbleSel]) => {
        const scroller = document.querySelector(scrollerSel);
        return {
          elementsTotal: document.getElementsByTagName('*').length,
          elementsInList: scroller.getElementsByTagName('*').length,
          rows: scroller.querySelectorAll(bubbleSel).length,
          scrollHeight: scroller.scrollHeight,
        };
      },
      [SCROLLER, BUBBLE_RECTS],
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const counters = await cdp.send('Memory.getDOMCounters');

    const scroll = await wheelToTop(page, Number(args['wheel-step']));
    return {
      openMs: round1(openMs),
      openRequests: opened.length,
      openBodyBytes: opened.reduce((s, r) => s + r.bodyBytes, 0),
      openTransferBytes: opened.reduce((s, r) => s + r.transferBytes, 0),
      historyRequests: history.length,
      historyMessages: ids.size,
      ...dom,
      domNodes: counters.nodes,
      heapMB: round1(heap.usedSize / 1048576),
      scroll: {
        ...scroll,
        p50: round1(scroll.p50),
        p95: round1(scroll.p95),
        max: round1(scroll.max),
        loafMax: round1(scroll.loafMax),
        loafBlocking: round1(scroll.loafBlocking),
      },
    };
  } finally {
    await context.close();
  }
}

/** 会话条数 × CPU 倍率矩阵：逐组测量，打印 Markdown 表并返回 JSON 结果 */
async function runPerf(browser, token) {
  const conversations = await api('GET', '/api/conversations', token);
  // 每个角色取第一段会话，与 seed-messages.py 写入的会话一致
  const sizes = args.sizes.split(',').map((item) => {
    const [n, name] = item.split(':');
    const conversation = conversations.find((c) => c.character_name === name);
    return {
      n: Number(n),
      name,
      conversationId: conversation.id,
      lastText: conversation.last_message.text,
    };
  });
  const cpus = args.cpu.split(',').map(Number);
  const results = [];
  for (const size of sizes) {
    for (const cpu of cpus) {
      const runs = [];
      for (let i = 0; i < Number(args.runs); i += 1) {
        const run = await measureRun(browser, token, size, cpu);
        console.error(
          `${size.n} 条 · ${cpu}× · 第 ${i + 1} 次：打开 ${run.openMs} ms，` +
            `帧 p95 ${run.scroll.p95} ms，聊天区元素 ${run.elementsInList}，历史 ${run.historyMessages} 条`,
        );
        runs.push(run);
      }
      results.push({ size: size.n, character: size.name, cpu, median: medianOf(runs), runs });
    }
  }

  console.log(
    row([
      '条数',
      'CPU',
      '打开耗时中位数',
      '打开耗时（各次）',
      '打开时消息 JSON',
      '历史请求',
      '历史条数',
      '页面元素',
      '聊天区元素',
      'DOM 消息行',
      '滚动中最多气泡',
      '帧 p50 / p95 / max',
      '>20 / >33 ms 帧',
      'LoAF 次数 / 最长',
      'JS 堆',
    ]),
  );
  console.log(row(Array(15).fill('---')));
  for (const { size, cpu, median: m, runs } of results) {
    console.log(
      row([
        size,
        `${cpu}×`,
        `${m.openMs} ms`,
        runs.map((r) => r.openMs).join(' / '),
        kb(m.openBodyBytes),
        m.historyRequests,
        m.historyMessages,
        m.elementsTotal,
        m.elementsInList,
        m.rows,
        m.scroll.rowsMax,
        `${m.scroll.p50} / ${m.scroll.p95} / ${m.scroll.max} ms`,
        `${m.scroll.over20} / ${m.scroll.over33}`,
        `${m.scroll.loafCount} / ${m.scroll.loafMax} ms`,
        `${m.heapMB} MB`,
      ]),
    );
  }
  return { sizes: sizes.map(({ lastText, ...rest }) => rest), cpus, results };
}

/** 注入每个文档的探针：记录登录表单、聊天页、设置弹窗首次出现的时刻，以及点击登录 / 设置的时刻 */
function lazyProbe() {
  const marks = {};
  window.__lazy = marks;
  const tests = {
    form: () => document.querySelector('form') !== null,
    chat: () =>
      document.querySelector('button[aria-label="设置"]') !== null &&
      document.querySelectorAll('[role="button"][data-collapsed]').length >= 29,
    settings: () => document.querySelector('[role="dialog"][aria-label="设置"]') !== null,
  };
  new MutationObserver(() => {
    for (const [key, test] of Object.entries(tests)) {
      if (marks[key] === undefined && test()) marks[key] = performance.now();
    }
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('button[aria-label="设置"]'))
        marks.settingsClick = performance.now();
      if (event.target.closest('button[type="submit"]')) marks.loginClick = performance.now();
    },
    true,
  );
}

/** 新建禁用缓存、可选网络限速的上下文；token 不为 null 时预先写入登录态 */
async function lazyPage(browser, token) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  if (token !== null) {
    await context.addInitScript((jwt) => localStorage.setItem('baker.token', jwt), token);
  }
  await context.addInitScript(lazyProbe);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (NETWORK[args.network] !== null) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      ...NETWORK[args.network],
    });
  }
  return { context, page };
}

/** 页面内：Resource Timing 里的 JS 请求与 /me 请求，时间相对导航开始 */
function readResources() {
  const entries = performance.getEntriesByType('resource');
  const me = entries.find((e) => e.name.endsWith('/api/auth/me'));
  return {
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    meStart: me?.startTime ?? null,
    js: entries
      .filter((e) => new URL(e.name).pathname.endsWith('.js'))
      .map((e) => ({
        url: e.name,
        startMs: Math.round(e.startTime * 10) / 10,
        endMs: Math.round(e.responseEnd * 10) / 10,
        transferBytes: e.transferSize,
        bodyBytes: e.encodedBodySize,
      })),
  };
}

/** 已算过的 JS gzip 字节，按 URL 缓存 */
const gzipCache = new Map();

/**
 * JS 文件的 gzip 字节：按 Node zlib 默认级别补算，与 vite build 报告的 gzip 大小一致；
 * vite preview 也会压缩（@polka/compression），但压缩级别和响应头与构建报告不同，传输字节不能直接对照
 */
async function gzipBytes(url) {
  if (!gzipCache.has(url)) {
    const data = Buffer.from(await (await fetch(url)).arrayBuffer());
    gzipCache.set(url, gzipSync(data).length);
  }
  return gzipCache.get(url);
}

/** 给 JS 请求列表补上文件名与 gzip 字节 */
async function withGzip(js) {
  return Promise.all(
    js.map(async (r) => ({
      file: decodeURIComponent(new URL(r.url).pathname.split('/').pop()),
      ...r,
      gzipBytes: await gzipBytes(r.url),
    })),
  );
}

/** 取 served index.html 里 <script type="module"> 指向的入口 JS 路径 */
async function entryPath() {
  const html = await (await fetch(`${args.base}/login`)).text();
  const src = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)[1];
  return new URL(src, args.base).pathname;
}

/** JS 请求汇总：入口文件的字节，与全部请求（含预取的 chunk）的合计 */
function jsSummary(js, entry) {
  const main = js.find((r) => new URL(r.url).pathname === entry);
  return {
    entryTransferBytes: main.transferBytes,
    entryGzipBytes: main.gzipBytes,
    jsRequests: js.length,
    jsTransferBytes: js.reduce((s, r) => s + r.transferBytes, 0),
    jsGzipBytes: js.reduce((s, r) => s + r.gzipBytes, 0),
  };
}

/** /login：首屏 JS 与表单出现时间；再点"一键填入""登录"，测到聊天页挂载 */
async function measureLogin(browser, entry) {
  const { context, page } = await lazyPage(browser, null);
  try {
    await page.goto(`${args.base}/login`, { waitUntil: 'networkidle' });
    const marks = await page.evaluate(() => window.__lazy);
    const resources = await page.evaluate(readResources);
    await page.getByRole('button', { name: '一键填入' }).click();
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForFunction(() => window.__lazy.chat !== undefined, null, { timeout: 60_000 });
    const after = await page.evaluate(() => window.__lazy);
    const js = await withGzip(resources.js);
    return {
      formMs: round1(marks.form),
      fcpMs: round1(resources.fcp),
      ...jsSummary(js, entry),
      loginToChatMs: round1(after.chat - after.loginClick),
      js,
    };
  } finally {
    await context.close();
  }
}

/**
 * 已登录打开 /：JS 请求、/me 与 ChatPage chunk 的开始时间、聊天页挂载时间；网络空闲后点设置按钮测弹窗出现
 */
async function measureHome(browser, token, entry) {
  const { context, page } = await lazyPage(browser, token);
  try {
    await page.goto(`${args.base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__lazy.chat !== undefined, null, { timeout: 60_000 });
    const marks = await page.evaluate(() => window.__lazy);
    const resources = await page.evaluate(readResources);
    await page.click('button[aria-label="设置"]');
    await page.waitForFunction(() => window.__lazy.settings !== undefined, null, {
      timeout: 60_000,
    });
    const after = await page.evaluate(() => window.__lazy);
    const js = await withGzip(resources.js);
    const chatChunk = js.find((r) => r.file.startsWith('ChatPage-'));
    return {
      chatMs: round1(marks.chat),
      meStartMs: round1(resources.meStart),
      chatChunkStartMs: chatChunk.startMs,
      // 负数表示聊天页 chunk 比 /me 更早开始下载
      chatChunkMinusMeMs: round1(chatChunk.startMs - resources.meStart),
      fcpMs: round1(resources.fcp),
      ...jsSummary(js, entry),
      settingsOpenMs: round1(after.settings - after.settingsClick),
      js,
    };
  } finally {
    await context.close();
  }
}

/** --lazy：/login 与已登录 / 各测 --runs 次，打印指标表与第一次的 JS 请求明细 */
async function runLazy(browser, token) {
  const entry = await entryPath();
  const login = [];
  const home = [];
  for (let i = 0; i < Number(args.runs); i += 1) {
    login.push(await measureLogin(browser, entry));
    home.push(await measureHome(browser, token, entry));
    console.error(
      `第 ${i + 1} 次（${args.network}）：/login 表单 ${login[i].formMs} ms，` +
        `/ 聊天页 ${home[i].chatMs} ms，设置弹窗 ${home[i].settingsOpenMs} ms`,
    );
  }
  const summary = { login: medianOf(login), home: medianOf(home) };

  const metrics = [
    ['/login 表单出现', login, 'formMs', 'ms'],
    ['/login 首次内容绘制', login, 'fcpMs', 'ms'],
    ['/login 入口 JS 传输字节', login, 'entryTransferBytes', 'B'],
    ['/login 入口 JS gzip 字节', login, 'entryGzipBytes', 'B'],
    ['/login 全部 JS 请求数（含预取的 chunk）', login, 'jsRequests', ''],
    ['/login 全部 JS 传输字节合计（含预取的 chunk）', login, 'jsTransferBytes', 'B'],
    ['/login 全部 JS gzip 字节合计（含预取的 chunk）', login, 'jsGzipBytes', 'B'],
    ['点击登录 → 聊天页挂载', login, 'loginToChatMs', 'ms'],
    ['/ 导航开始 → 聊天页挂载', home, 'chatMs', 'ms'],
    ['/ /me 请求开始', home, 'meStartMs', 'ms'],
    ['/ ChatPage chunk 请求开始', home, 'chatChunkStartMs', 'ms'],
    ['/ ChatPage chunk 开始 − /me 开始', home, 'chatChunkMinusMeMs', 'ms'],
    ['/ 入口 JS 传输字节', home, 'entryTransferBytes', 'B'],
    ['/ 入口 JS gzip 字节', home, 'entryGzipBytes', 'B'],
    ['/ 全部 JS 请求数（含预取的 chunk）', home, 'jsRequests', ''],
    ['/ 全部 JS 传输字节合计（含预取的 chunk）', home, 'jsTransferBytes', 'B'],
    ['/ 全部 JS gzip 字节合计（含预取的 chunk）', home, 'jsGzipBytes', 'B'],
    ['点击设置 → 弹窗出现', home, 'settingsOpenMs', 'ms'],
  ];
  console.log(`网络限速：${args.network}；${args.runs} 次中位数；入口 JS：${entry}\n`);
  console.log(row(['指标', '中位数', '各次']));
  console.log(row(['---', '---', '---']));
  for (const [label, runs, key, unit] of metrics) {
    const value = round1(median(runs.map((r) => r[key])));
    console.log(row([label, `${value} ${unit}`.trim(), runs.map((r) => r[key]).join(' / ')]));
  }
  for (const [label, runs] of [
    ['/login', login],
    ['已登录 /', home],
  ]) {
    console.log(`\n${label} 第 1 次的 JS 请求：\n`);
    console.log(row(['文件', '开始 ms', '结束 ms', '传输', 'gzip']));
    console.log(row(['---', '---', '---', '---', '---']));
    for (const r of runs[0].js) {
      console.log(row([r.file, r.startMs, r.endMs, kb(r.transferBytes), kb(r.gzipBytes)]));
    }
  }
  return { network: args.network, entry, summary, runs: { login, home } };
}

/** --typing：一次测量。打开会话 → 降速 → 采样帧间隔 → 发送 → 等回复全部显示 → 汇总 */
async function measureTyping(browser, token, conversationId, typewriter, cpu) {
  await api('PATCH', '/api/settings', token, { typewriter });
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript((jwt) => localStorage.setItem('baker.token', jwt), token);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(`${args.base}/`);
    await (await firstSubCard(page, args['typing-character'])).dispatchEvent('click');
    await page.locator(SCROLLER).waitFor({ state: 'attached' });
    await page.evaluate(() => Promise.all([...document.fonts].map((font) => font.load())));
    const input = page.getByRole('textbox', { name: '发消息输入框' });
    await input.click();
    await page.keyboard.type('你好');
    await page.waitForTimeout(400);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.evaluate(startFrameSampler, SCROLLER);
    const start = Date.now();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60_000 });
    const replyMs = Date.now() - start;
    const frames = await page.evaluate(stopFrameSampler);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { replyMs, frames };
  } finally {
    await context.close();
    await api('POST', `/api/conversations/${conversationId}/messages/clear`, token);
    await api('POST', `/api/conversations/${conversationId}/context/clear`, token);
  }
}

/** --typing：打字机开启 / 关闭 × 各降速倍率各测 --runs 次，打印中位数表与各次原始值 */
async function runTyping(browser, token) {
  const conversations = await api('GET', '/api/conversations', token);
  const conversation = conversations.find((c) => c.character_name === args['typing-character']);
  const { typewriter: original } = await api('GET', '/api/settings', token);
  const cpus = args.cpu.split(',').map(Number);
  const results = [];
  try {
    for (const typewriter of [true, false]) {
      for (const cpu of cpus) {
        const runs = [];
        for (let i = 0; i < Number(args.runs); i += 1) {
          const run = await measureTyping(browser, token, conversation.id, typewriter, cpu);
          console.error(
            `${typewriter ? '打字机' : '整行'} · ${cpu}× · 第 ${i + 1} 次：回复 ${run.replyMs} ms，` +
              `帧 p95 ${round1(run.frames.p95)} ms，>33 ms ${run.frames.over33} 帧`,
          );
          runs.push(run);
        }
        results.push({ typewriter, cpu, median: medianOf(runs), runs });
      }
    }
  } finally {
    await api('PATCH', '/api/settings', token, { typewriter: original });
  }
  console.log(
    row([
      '显示方式',
      'CPU',
      '回复耗时（Enter → 全部显示）',
      '帧数',
      '帧 p50 / p95 / max',
      '>20 / >33 ms 帧',
      'LoAF 次数 / 最长',
    ]),
  );
  console.log(row(Array(7).fill('---')));
  for (const r of results) {
    const f = r.median.frames;
    console.log(
      row([
        r.typewriter ? '打字机' : '整行',
        `${r.cpu}×`,
        `${r.median.replyMs} ms`,
        f.frames,
        `${f.p50} / ${f.p95} / ${f.max} ms`,
        `${f.over20} / ${f.over33}`,
        `${f.loafCount} / ${f.loafMax} ms`,
      ]),
    );
  }
  return results;
}

/** 登录拿 token，按模式测量并写出 JSON */
async function main() {
  if (!(args.network in NETWORK)) throw new Error(`--network 只能是 ${Object.keys(NETWORK)}`);
  const { token } = await api('POST', '/api/auth/login', null, {
    username: args.user,
    password: args.password,
  });
  const browser = await chromium.launch();
  try {
    const meta = {
      date: new Date().toISOString(),
      base: args.base,
      api: args.api,
      browser: `chromium ${browser.version()}`,
      viewport: VIEWPORT,
      runs: Number(args.runs),
    };
    const result = args.typing
      ? { meta, typing: await runTyping(browser, token) }
      : args.lazy
        ? { meta, lazy: await runLazy(browser, token) }
        : {
            meta: { ...meta, wheelStep: Number(args['wheel-step']) },
            ...(await runPerf(browser, token)),
          };
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
    console.error(`\n结果已写入 ${args.out}`);
  } finally {
    await browser.close();
  }
}

await main();
