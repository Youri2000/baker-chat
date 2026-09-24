/**
 * @file 路由守卫：未登录访问 / 被送到 /login；用演示账号（一键填入）登录后进入 /；
 * 在设置 › 关于里退出登录后回到 /login 且 localStorage 里的 token 被清除。
 */
import { expect, test } from '@playwright/test';

test('未登录访问 / 跳到 /login，演示账号登录后进入 /，退出登录后回到 /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');

  // 演示账号 demo/demo123 由后端启动时种子，登录页提供一键填入
  await page.getByRole('button', { name: '一键填入', exact: true }).click();
  await expect(page.getByLabel('用户名')).toHaveValue('demo');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/');

  // 退出登录入口在设置对话框的"关于"标签页
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '关于', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(await page.evaluate(() => localStorage.getItem('baker.token'))).toBeNull();
});
