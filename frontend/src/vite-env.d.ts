/**
 * @file Vite 客户端类型补充：声明本项目用到的环境变量，供 `import.meta.env` 类型检查。
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端根地址（不含 /api），来自 .env */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
