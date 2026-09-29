/**
 * @file 打字机效果：默认开启时，同一个 AI 气泡先后出现多个长度不同的前缀（逐字写出），写完后与刷新后的内容一致；
 * 在设置"AI 配置"里关闭开关后，下一条回复整行出现，不再出现未写完的前缀；开关按用户保存到后端。
 * 用页面内 MutationObserver 记录消息区出现过的每一个气泡文字，逐字过程的中间状态不会被轮询漏掉。
 * 主卡 / 子卡是 0×0 的 role=button 容器，Playwright 判定为不可见，用 dispatchEvent('click') 触发 React 的委托事件。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

/** 后端 AI_MOCK=1 时的固定回复（backend/app/ai.py 的 MOCK_TEXT），按行即 3 个气泡 */
const MOCK_LINES = ['收到，管理员。', '这是一条来自 mock 的回复。', '第三行用于验证分段。'];

/** 记录的文字存在消息区元素的这个属性上 */
type Recorded = { __bubbleTexts?: string[] };

/** 开始记录消息区里出现过的每一个气泡文字（包括逐字写出过程中的每个前缀） */
function startRecording(log: Locator): Promise<void> {
  return log.evaluate((el) => {
    const seen = new Set<string>();
    const target = el as unknown as Recorded;
    /** 收集当前所有气泡的文字 */
    const collect = () => {
      for (const node of el.querySelectorAll('svg foreignObject > div')) {
        seen.add(node.textContent ?? '');
      }
      target.__bubbleTexts = [...seen];
    };
    const Observer = el.ownerDocument.defaultView!.MutationObserver;
    new Observer(collect).observe(el, { subtree: true, childList: true, characterData: true });
    collect();
  });
}

/** 读出记录到的气泡文字 */
function recordedTexts(log: Locator): Promise<string[]> {
  return log.evaluate((el) => (el as unknown as Recorded).__bubbleTexts ?? []);
}

/** 打开"陈千语"的会话；preview 为子卡上显示的预览文字 */
async function openConversation(page: Page, preview: string): Promise<Locator> {
  await page.getByRole('button', { name: '陈千语', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: preview, exact: true }).dispatchEvent('click');
  const log = page.getByRole('log', { name: '消息列表' });
  await expect(log).toBeVisible();
  return log;
}

/** 输入一条消息并按 Enter 发送，等 AI 回复全部显示完（停止按钮换回发送按钮） */
async function sendAndWait(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '发消息输入框' }).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** 记录到的文字里，属于某一行、但比它短的前缀 */
function prefixesOf(texts: string[], line: string): string[] {
  return texts.filter((text) => text !== '' && text !== line && line.startsWith(text));
}

test('打字机：逐字写出、写完与刷新后一致；关闭开关后整行出现', async ({ page, request }) => {
  test.setTimeout(60_000);
  const backendUrl = test.info().config.metadata.backendUrl as string;
  const auth = (await (
    await request.post(`${backendUrl}/api/auth/register`, {
      data: { username: `e2e_type_${Date.now().toString(36)}`, password: 'secret123' },
    })
  ).json()) as { token: string };
  const headers = { Authorization: `Bearer ${auth.token}` };

  await page.addInitScript((token) => localStorage.setItem('baker.token', token), auth.token);
  await page.goto('/');
  let log = await openConversation(page, '和她聊聊');
  const bubbleTexts = log.locator('svg foreignObject > div');

  // 默认开启：同一个气泡先后出现至少 3 个不同长度的前缀，每个都是最终那一行的开头
  await startRecording(log);
  await sendAndWait(page, '你好');
  const typed = await recordedTexts(log);
  expect(prefixesOf(typed, MOCK_LINES[0]).length).toBeGreaterThanOrEqual(2);
  for (const text of typed) {
    expect(['你好', ...MOCK_LINES].some((line) => line.startsWith(text))).toBe(true);
  }
  await expect(bubbleTexts).toHaveText(['你好', ...MOCK_LINES]);

  // 刷新后内容相同，直接完整显示
  await page.reload();
  log = await openConversation(page, MOCK_LINES[2]);
  await expect(log.locator('svg foreignObject > div')).toHaveText(['你好', ...MOCK_LINES]);

  // 设置 › AI 配置里关闭打字机效果：切换即保存到账号
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '打字机效果（AI 回复逐字写出）' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const settings = await request.get(`${backendUrl}/api/settings`, { headers });
      return ((await settings.json()) as { typewriter: boolean }).typewriter;
    })
    .toBe(false);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  // 关闭后：新回复的每一行都整行出现，不再出现未写完的前缀
  await startRecording(log);
  await sendAndWait(page, '再来');
  const lined = await recordedTexts(log);
  for (const line of MOCK_LINES) {
    expect(prefixesOf(lined, line)).toEqual([]);
  }
  await expect(log.locator('svg foreignObject > div')).toHaveText([
    '你好',
    ...MOCK_LINES,
    '再来',
    ...MOCK_LINES,
  ]);
});
