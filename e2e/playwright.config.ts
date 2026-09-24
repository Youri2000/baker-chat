/**
 * @file Playwright 配置：只跑 chromium；运行前由 webServer 拉起后端（AI_MOCK=1、独立的临时 SQLite）与前端 Vite，
 * 端口固定为 8020 / 5180，用例通过 baseURL 访问前端，通过 metadata.backendUrl 直接查后端接口核对持久化结果。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = 5180;
const BACKEND_PORT = 8020;
/** 浏览器一侧用 localhost（与后端 CORS 白名单一致） */
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
/**
 * ⚠️ Node 一侧（就绪探测、request fixture）固定走 127.0.0.1：本机 shell 若设有 HTTP_PROXY，Playwright 的探测会经代理访问
 * localhost，代理只解析到 IPv4；Vite 默认只监听 [::1]，探测会一直收到代理的 502。两个服务因此都显式绑定 127.0.0.1。
 */
const LOOPBACK = '127.0.0.1';
const BACKEND_PROBE_URL = `http://${LOOPBACK}:${BACKEND_PORT}`;
const FRONTEND_PROBE_URL = `http://${LOOPBACK}:${FRONTEND_PORT}`;
const BACKEND_DIR = path.resolve(import.meta.dirname, '../backend');
const FRONTEND_DIR = path.resolve(import.meta.dirname, '../frontend');
/** 每次运行前删掉，从空库开始；演示账号由后端启动时重新种子 */
const DB_FILE = path.join(import.meta.dirname, '.tmp', 'e2e.db');
/** 只用于 E2E 的 HS256 密钥（≥32 字节，避免 PyJWT 的短密钥告警），不是任何环境的真实密钥 */
const JWT_SECRET = 'e2e-only-jwt-secret-0123456789abcdef0123456789';

/**
 * 启动后端的命令前缀：优先 E2E_BACKEND_CMD；本机有 backend/.venv 就用它（系统 python 未必装了 uvicorn）；
 * CI 里 pip install -e 装进 setup-python 的解释器，直接 python -m uvicorn。
 */
function backendCommand(): string {
  if (process.env.E2E_BACKEND_CMD !== undefined) return process.env.E2E_BACKEND_CMD;
  const venvPython = path.join(BACKEND_DIR, '.venv', 'bin', 'python');
  return existsSync(venvPython) ? `${venvPython} -m uvicorn` : 'python -m uvicorn';
}

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  // CI 只上传 html 报告；本地 list 输出足够
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  metadata: { backendUrl: BACKEND_PROBE_URL },
  use: {
    baseURL: FRONTEND_URL,
    // 与设计画布同尺寸，zoom 为 1，坐标不缩放
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // ⚠️ 删库放在启动命令里而不是配置顶层：worker 进程也会加载本文件，顶层副作用会在服务运行中把库删掉
      command: `rm -f "${DB_FILE}" && cd "${BACKEND_DIR}" && ${backendCommand()} app.main:app --host ${LOOPBACK} --port ${BACKEND_PORT}`,
      url: `${BACKEND_PROBE_URL}/health`,
      reuseExistingServer: false,
      env: {
        AI_MOCK: '1',
        JWT_SECRET,
        DATABASE_URL: `sqlite:///${DB_FILE}`,
        CORS_ORIGINS: FRONTEND_URL,
      },
    },
    {
      command: `cd "${FRONTEND_DIR}" && pnpm exec vite --host ${LOOPBACK} --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_PROBE_URL,
      reuseExistingServer: false,
      // 进程环境变量优先于 frontend/.env，指向 E2E 专用后端
      env: { VITE_API_BASE_URL: BACKEND_URL },
    },
  ],
});
