/**
 * @file 冒烟主流程：注册 → 29 张主卡 → 展开"陈千语"并选中子卡 → 输入两行文本 + 一个表情 → Enter 发送 →
 * mock 回复按行出现 3 个 AI 气泡 → 后端存储的文本与刷新后的气泡数量都与发送内容一致。
 * 主卡 / 子卡是 0×0 的 role=button 容器，Playwright 判定为不可见，用 dispatchEvent('click') 触发 React 的委托事件。
 */
import { expect, test } from '@playwright/test';

/** 后端 AI_MOCK=1 时的固定回复（backend/app/ai.py 的 MOCK_TEXT），按行即 3 个气泡 */
const MOCK_LINES = ['收到，管理员。', '这是一条来自 mock 的回复。', '第三行用于验证分段。'];

test('注册后向陈千语发送多行带表情的消息，收到按行分段的三个 AI 气泡并持久化', async ({
  page,
  request,
}) => {
  const backendUrl = test.info().config.metadata.backendUrl as string;
  const username = `e2e_${Date.now().toString(36)}`;

  // 注册即登录，自动进入 /
  await page.goto('/register');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByLabel('确认密码').fill('secret123');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL('/');

  // 全部折叠时列表里只有 29 张主卡（子卡折叠时不挂载）
  const cards = page.locator('[role="button"]');
  await expect(cards).toHaveCount(29);

  // 展开陈千语（female → 空会话文案"和她聊聊"），再单击它的子卡
  await page.getByRole('button', { name: '陈千语', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: '和她聊聊', exact: true }).dispatchEvent('click');
  const input = page.getByRole('textbox', { name: '发消息输入框' });
  await expect(input).toBeVisible();

  // 两行文本（Shift+Enter 换行）+ 弹层里的第一个表情，Enter 发送
  await input.click();
  await page.keyboard.type('第一行');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('第二行');
  await page.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '[sns_emoji_001]', exact: true }).click();
  await page.keyboard.press('Enter');

  // mock 每 80ms 发 5 个字，三行依次固化为气泡（气泡文字在 SVG foreignObject 里；
  // 流结束后子卡预览也会显示最后一行，所以只在气泡范围内找）；结束后停止按钮换回发送按钮
  const bubbleTexts = page.locator('svg foreignObject > div');
  for (const line of MOCK_LINES) {
    await expect(bubbleTexts.filter({ hasText: line })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  // 气泡顺序：我方 1 条在前，3 条 AI 按 mock 的行序在后
  await expect(bubbleTexts).toHaveCount(4);
  await expect(bubbleTexts.nth(1)).toHaveText(MOCK_LINES[0]);
  await expect(bubbleTexts.nth(2)).toHaveText(MOCK_LINES[1]);
  await expect(bubbleTexts.nth(3)).toHaveText(MOCK_LINES[2]);

  // 后端存储：换行保留为 \n，表情以 token 存；3 条 other 均为 completed
  const token = await page.evaluate(() => localStorage.getItem('baker.token'));
  const headers = { Authorization: `Bearer ${token}` };
  const conversations = (await (
    await request.get(`${backendUrl}/api/conversations`, { headers })
  ).json()) as Array<{
    id: number;
    character_name: string;
  }>;
  const conversation = conversations.find((c) => c.character_name === '陈千语')!;
  const messages = (await (
    await request.get(`${backendUrl}/api/conversations/${conversation.id}/messages`, { headers })
  ).json()) as Array<{ side: string; text: string; status: string }>;
  expect(messages.map((m) => [m.side, m.text, m.status])).toEqual([
    ['mine', '第一行\n第二行[sns_emoji_001]', 'completed'],
    ...MOCK_LINES.map((line) => ['other', line, 'completed']),
  ]);

  // 刷新后选中状态不保留，重新展开；子卡预览已是最后一行，气泡仍是 1 条我方 + 3 条 AI
  await page.reload();
  await page.getByRole('button', { name: '陈千语', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: MOCK_LINES[2], exact: true }).dispatchEvent('click');
  await expect(page.locator('svg rect.fill-bubble-mine')).toHaveCount(1);
  await expect(page.locator('svg rect.fill-bubble-other')).toHaveCount(3);
});
