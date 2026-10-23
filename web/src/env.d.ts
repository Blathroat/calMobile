/// <reference types="vite/client" />

/**
 * 构建期注入的应用版本，来自与 Gradle 同一份 `scripts/client-target.mjs`。
 * 网页用它判断「服务器上的最新版本是不是比自己新」。
 */
declare const __APP_VERSION__: string;
declare const __APP_VERSION_CODE__: number;
