/**
 * @file 首个 AI 气泡出现时间：用 Playwright 打开前端，登录（接口拿 token 注入 localStorage），为指定角色新建会话并选中，
 * 发送固定提问，在页面内用 performance.now() 记录三个时刻：
 *   t0 = 输入框收到 Enter 的 keydown；t1 = 第一个 AI 文字气泡插入 DOM；t2 = 加载气泡消失（前端处理完 [DONE]）。
 * t1 − t0 是"流式按行"策略下用户看到第一句话的时间；t2 − t0 是原项目"等全文再显示"策略下看到第一句话的时间。
 * 重复 --runs 次取中位数；结束后删除本脚本创建的会话。依赖 e2e 工作区安装的 @playwright/test 与它的 Chromium。
 * 复现（前端需以对应的 VITE_API_BASE_URL 构建或启动）：
 *   node scripts/measure/first-bubble.mjs --base http://localhost:5182 --api http://localhost:8022 \
 *     --user demo --password demo123 --character 陈千语 --prompt "请用三句话介绍一下你自己" --runs 5
 */
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

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
    character: { type: 'string', default: '陈千语' },
    prompt: { type: 'string', default: '请用三句话介绍一下你自己' },
    runs: { type: 'string', default: '5' },
  },
});

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

/**
 * 在页面里安装探针：Enter keydown 记 t0，MutationObserver 记第一个新 AI 文字气泡（t1）
 * 与加载气泡出现后消失（t2）。加载气泡的 rect 也带 fill-bubble-other，用 role=status 排除。
 */
function installProbe() {
  const probe = { t0: 0, t1: 0, t2: 0, loadingSeen: false };
  window.__probe = probe;
  const bubbles = () =>
    document.querySelectorAll('svg:not([role="status"]) > rect.fill-bubble-other').length;
  const baseline = bubbles();
  document.querySelector('[aria-label="发消息输入框"]').addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey) probe.t0 = performance.now();
    },
    true,
  );
  const observer = new MutationObserver(() => {
    if (probe.t1 === 0 && bubbles() > baseline) probe.t1 = performance.now();
    const loading = document.querySelector('[role="status"][aria-label="正在回复"]');
    if (loading !== null) probe.loadingSeen = true;
    else if (probe.loadingSeen && probe.t2 === 0) {
      probe.t2 = performance.now();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** 登录、建会话、在浏览器里选中它并重复测量 */
async function main() {
  const runs = Number(args.runs);
  const { token } = await api('POST', '/api/auth/login', null, {
    username: args.user,
    password: args.password,
  });
  const conversation = await api('POST', '/api/conversations', token, {
    character_name: args.character,
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript((jwt) => localStorage.setItem('baker.token', jwt), token);
  const results = [];
  try {
    await page.goto(`${args.base}/`);
    // 主卡与子卡是零尺寸容器，Playwright 认为不可见，用 dispatchEvent 触发 React 的委托点击
    const mainCard = page.locator('[role="button"]', { hasText: args.character }).first();
    await mainCard.waitFor({ state: 'attached' });
    await mainCard.dispatchEvent('click');
    // 新建的会话排在该角色最后一张子卡
    await mainCard.locator('..').locator('[role="button"]').last().dispatchEvent('click');
    const input = page.locator('[aria-label="发消息输入框"]');
    await input.waitFor({ state: 'attached' });

    for (let i = 0; i < runs; i += 1) {
      await page.locator('[aria-label="发送"]').waitFor({ state: 'attached' });
      await page.evaluate(installProbe);
      await input.fill(args.prompt);
      await input.press('Enter');
      await page.waitForFunction(() => window.__probe.t2 > 0, null, { timeout: 120_000 });
      const { t0, t1, t2 } = await page.evaluate(() => window.__probe);
      results.push({ first: t1 - t0, done: t2 - t0 });
      console.log(
        `run ${i + 1}: 首个气泡 ${(t1 - t0).toFixed(0)} ms，全文完成 ${(t2 - t0).toFixed(0)} ms`,
      );
    }
  } finally {
    await browser.close();
    await api('DELETE', `/api/conversations/${conversation.id}`, token);
  }

  const first = median(results.map((r) => r.first));
  const done = median(results.map((r) => r.done));
  console.log(`\n${runs} 次中位数：`);
  console.log('| 策略 | 用户看到第一句话 |\n| --- | --- |');
  console.log(`| 流式按行（t1） | ${first.toFixed(0)} ms |`);
  console.log(`| 等全文再显示（t2，原项目策略） | ${done.toFixed(0)} ms |`);
  console.log(`| 提前 | ${(done - first).toFixed(0)} ms |`);
}

await main();
