/**
 * @file 设置 › 关于：本项目的更新日志、相关链接、技术栈说明与"退出登录"按钮。
 * 样式对应原 sd__about-*；退出登录直接调 authStore.logout，路由守卫随即跳回 /login。
 */
import { useAuthStore } from '@/features/auth/authStore';
import { SettingsButton } from '@/features/settings/SettingsButton';

/** 小标题 */
const HEADING_CLASS = 'text-text-primary text-[15px] font-medium';
/** 日志条目 / 链接 / 技术栈条目：13px、1.8 行高、65% 白 */
const ITEM_CLASS = 'text-text-primary/65 text-[13px] leading-[1.8]';
/** 链接：强调色，hover 提亮 */
const LINK_CLASS = 'text-accent hover:text-[#fff983]';

/** 关于标签页 */
export function AboutTab() {
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="mb-1 text-center text-[18px] font-semibold text-text-primary">
        Baker Chat · 终末地 BAKER 会话消息
      </h3>

      <div className="flex flex-col gap-2">
        <h4 className={HEADING_CLASS}>更新日志</h4>
        <div className="flex flex-col gap-0.5">
          <p className="mb-0.5 text-[16px] font-semibold text-text-primary">2026-09-24</p>
          <p className={`${ITEM_CLASS} pl-2.5`}>
            React 19 + TypeScript 重写前端，Tailwind CSS v4 还原原版视觉
          </p>
          <p className={`${ITEM_CLASS} pl-2.5`}>
            新增 FastAPI 后端与账号登录，会话与设置按用户保存
          </p>
          <p className={`${ITEM_CLASS} pl-2.5`}>AI 改为后端代理 DeepSeek，回复流式按行逐条出现</p>
          <p className={`${ITEM_CLASS} pl-2.5`}>去掉截图导出、ZIP 导入导出、自定义背景与移动端</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className={HEADING_CLASS}>相关链接</h4>
        <ul className={ITEM_CLASS}>
          <li>
            <a
              className={LINK_CLASS}
              href="https://github.com/Youri2000/baker-chat"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </a>
          </li>
          <li>
            <a
              className={LINK_CLASS}
              href="https://github.com/NCreeper233/endfield-baker-chat"
              target="_blank"
              rel="noopener"
            >
              原项目 endfield-baker-chat（Vue 3）
            </a>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className={HEADING_CLASS}>技术栈</h4>
        <ul className={ITEM_CLASS}>
          <li>前端：React 19、TypeScript、Vite、Tailwind CSS v4、Zustand、React Router</li>
          <li>后端：FastAPI、SQLAlchemy 2、Pydantic v2、SQLite / Postgres、DeepSeek API</li>
          <li>
            工程：Vitest + React Testing Library、pytest、Playwright、ESLint / ruff、GitHub Actions
          </li>
        </ul>
      </div>

      <div className="mt-1 flex gap-2">
        <SettingsButton onClick={logout}>退出登录</SettingsButton>
      </div>
    </div>
  );
}
