/// <reference types="vite/client" />

/**
 * 构建期注入的应用版本，来自与 Gradle 同一份 `scripts/client-target.mjs`。
 * 网页用它判断「服务器上的最新版本是不是比自己新」。
 */
declare const __APP_VERSION__: string;
declare const __APP_VERSION_CODE__: number;

/**
 * 构建期注入的应用名覆盖，来自 `web/.env*` 的 `PWA_APP_NAME`（见 `vite.config.ts`）。
 * 空串表示没有覆盖，页面标题回落到 `zh.json` 的 `app.documentTitle`。
 */
declare const __PWA_APP_NAME_OVERRIDE__: string;
