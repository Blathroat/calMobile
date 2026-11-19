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

/**
 * 服务端在 `index.html` / `join.html` 里注入的运行时品牌。
 * 没有这份脚本时（旧快照或纯静态页面）页面沿用构建期默认值。
 */
interface Window {
  /**
   * Android 外壳在页面加载完成时注入的原生版本名（`BuildConfig.VERSION_NAME`）。
   * 页面包可能来自较新的 npm 运行时，不能用页面构建版本代替已安装 APK 的版本；
   * 有这个值时更新检查优先用它。
   */
  __CALMOBILE_NATIVE_VERSION__?: string;
  __CALMOBILE_BRANDING__?: {
    appName?: string;
    shortName?: string;
    description?: string;
    appTitle?: string;
    joinTitle?: string;
    lang?: string;
    themeColor?: string;
    themeColorDark?: string;
    backgroundColor?: string;
  };
}
