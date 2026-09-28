/**
 * @file 长会话滚动：接口注册并向"陈千语"连发 20 条（mock 每条回 3 行，共 80 条消息）→ 打开会话只取最近 50 条并停在底部 →
 * 向上浏览出现"回到底部"（文字单行、在胶囊内），点击后回到底部 → 发送后向上浏览，后续回复行不把视图拉回底部，按钮变为"有新消息" →
 * 虚拟列表只渲染可视区附近的行 → 滚到顶部附近加载更早的 30 条，原来可见的消息在屏幕上不动 → 没有更早的消息后不再请求。
 * 主卡 / 子卡是 0×0 的 role=button 容器，Playwright 判定为不可见，用 dispatchEvent('click') 触发 React 的委托事件。
 */
import { expect, test, type Locator } from '@playwright/test';

/** 后端 AI_MOCK=1 时的固定回复（backend/app/ai.py 的 MOCK_TEXT），按行即 3 个气泡 */
const MOCK_LINES = ['收到，管理员。', '这是一条来自 mock 的回复。', '第三行用于验证分段。'];

/** 预先发送的条数：每条 1 条我方 + 3 条 AI，共 80 条，超过一页（50） */
const SEEDED = 20;

/** 滚动容器距底部的距离（设计 px） */
function distanceToBottom(log: Locator): Promise<number> {
  return log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

/** 可视区内第一条完整可见的我方种子消息：返回文本与它在屏幕上的纵坐标 */
function firstVisibleSeed(log: Locator): Promise<{ text: string; top: number } | null> {
  return log.evaluate((el) => {
    const box = el.getBoundingClientRect();
    for (const node of el.querySelectorAll('svg foreignObject > div')) {
      const text = node.textContent ?? '';
      const top = node.getBoundingClientRect().top;
      if (text.startsWith('种子 ') && top >= box.top && top <= box.bottom - 40)
        return { text, top };
    }
    return null;
  });
}

/**
 * 等可视区稳定后取锚点：直接把 scrollTop 设到顶部附近时，第一次渲染的行先按估计高度排版，
 * 测量完成后会上下挪动几帧；连续两次（间隔 100ms）取到同一位置才算稳定
 */
async function stableSeed(log: Locator): Promise<{ text: string; top: number } | null> {
  let previous = await firstVisibleSeed(log);
  for (let i = 0; i < 20; i += 1) {
    await log.page().waitForTimeout(100);
    const current = await firstVisibleSeed(log);
    if (
      current !== null &&
      previous !== null &&
      current.text === previous.text &&
      Math.abs(current.top - previous.top) < 0.5
    ) {
      return current;
    }
    previous = current;
  }
  return null;
}

/**
 * 按钮文字是否只占一行且在胶囊上下边之内：文字折行时文本节点会有多个行框，或超出按钮
 * （按钮在 0×0 定位容器里，缺 whitespace-nowrap 时会一字一行溢出，只按名称查找发现不了）
 */
function labelOnOneLine(button: Locator): Promise<boolean> {
  return button.evaluate((el) => {
    // 按钮的第一个子节点是文字（其后是箭头图片）；e2e 的 tsconfig 不含 DOM 全局，用 ownerDocument 与 nodeType 常量 3
    const text = el.firstChild;
    if (text === null || text.nodeType !== 3) return false;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(text);
    const lines = range.getClientRects();
    const box = el.getBoundingClientRect();
    return lines.length === 1 && lines[0].top >= box.top && lines[0].bottom <= box.bottom;
  });
}

/** 同一文本的消息现在在屏幕上的纵坐标 */
function topOf(log: Locator, text: string): Promise<number | null> {
  return log.evaluate((el, wanted) => {
    for (const node of el.querySelectorAll('svg foreignObject > div')) {
      if (node.textContent === wanted) return node.getBoundingClientRect().top;
    }
    return null;
  }, text);
}

test('长会话：停在底部、回到底部按钮、回复不打断浏览、虚拟列表、加载更早历史保持位置', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const backendUrl = test.info().config.metadata.backendUrl as string;
  const username = `e2e_scroll_${Date.now().toString(36)}`;

  // 接口注册并预先发送 SEEDED 条：等每条回复的流读完再发下一条
  const auth = (await (
    await request.post(`${backendUrl}/api/auth/register`, {
      data: { username, password: 'secret123' },
    })
  ).json()) as { token: string };
  const headers = { Authorization: `Bearer ${auth.token}` };
  const conversations = (await (
    await request.get(`${backendUrl}/api/conversations`, { headers })
  ).json()) as Array<{ id: number; character_name: string }>;
  const conversation = conversations.find((c) => c.character_name === '陈千语')!;
  for (let i = 1; i <= SEEDED; i += 1) {
    const res = await request.post(`${backendUrl}/api/conversations/${conversation.id}/chat`, {
      headers,
      data: { text: `种子 ${i}` },
    });
    await res.text();
  }

  // 记录前端发出的消息请求：before_id 为 null 表示最近一页
  const beforeIds: Array<string | null> = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname === `/api/conversations/${conversation.id}/messages`) {
      beforeIds.push(url.searchParams.get('before_id'));
    }
  });

  await page.addInitScript((token) => localStorage.setItem('baker.token', token), auth.token);
  await page.goto('/');
  await page.getByRole('button', { name: '陈千语', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: MOCK_LINES[2], exact: true }).dispatchEvent('click');
  const log = page.getByRole('log', { name: '消息列表' });
  await expect(log).toBeVisible();

  // 打开会话：只取最近一页，停在底部，没有按钮
  await expect.poll(() => distanceToBottom(log)).toBeLessThanOrEqual(2);
  expect(beforeIds).toEqual([null]);
  await expect(page.getByRole('button', { name: '回到底部' })).toBeHidden();

  // 向上滚动：出现"回到底部"；点击后平滑回到底部，按钮消失
  await log.hover();
  await page.mouse.wheel(0, -1200);
  await expect(page.getByRole('button', { name: '回到底部' })).toBeVisible();
  expect(await labelOnOneLine(page.getByRole('button', { name: '回到底部' }))).toBe(true);
  await page.getByRole('button', { name: '回到底部' }).click();
  await expect.poll(() => distanceToBottom(log)).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: '回到底部' })).toBeHidden();

  // 发送后立即向上浏览：之后到达的回复行不改变滚动位置，按钮变为"有新消息"
  const input = page.getByRole('textbox', { name: '发消息输入框' });
  await input.click();
  await page.keyboard.type('浏览中');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: '正在回复' })).toBeVisible();
  await page.mouse.wheel(0, -600);
  await expect(page.getByRole('button', { name: /回到底部|有新消息/ })).toBeVisible();
  const pausedTop = await log.evaluate((el) => el.scrollTop);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '有新消息' })).toBeVisible();
  expect(await labelOnOneLine(page.getByRole('button', { name: '有新消息' }))).toBe(true);
  expect(Math.abs((await log.evaluate((el) => el.scrollTop)) - pausedTop)).toBeLessThanOrEqual(2);

  // 虚拟列表：已加载 54 条，DOM 里只渲染可视区附近的行
  expect(await log.locator('[data-index]').count()).toBeLessThanOrEqual(60);

  // 加载更早历史：请求延迟 1500ms，期间等可视区稳定后记下一条可见消息的位置，插入后它在屏幕上不动（±2px）。
  // 停在最顶部（scrollTop 0，首条气泡上方的留白还露在可视区里）是最难的情形：插入后新行会露在可视区顶部
  await page.route('**/messages?before_id=*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const earlier = page.waitForResponse((res) => res.url().includes('before_id='));
  await log.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.getByRole('status', { name: '正在回复' })).toBeVisible();
  const anchor = await stableSeed(log);
  expect(anchor).not.toBeNull();
  await earlier;
  await expect.poll(() => beforeIds.filter((id) => id !== null).length).toBe(1);
  await expect
    .poll(async () => Math.abs((await topOf(log, anchor!.text))! - anchor!.top))
    .toBeLessThanOrEqual(2);

  // 已加载全部 84 条：再滚到顶部不再请求
  await log.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(log.getByText('种子 1', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(beforeIds.filter((id) => id !== null)).toHaveLength(1);
});
