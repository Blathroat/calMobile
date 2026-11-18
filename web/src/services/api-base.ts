/**
 * 页面到后端的接口基址。
 *
 * **页面包不带域名**：应用页面、PWA、报名站都由同一个服务端进程托管，页面和 API 必须
 * 同源。这里固定用相对路径 `/api/v1`，所以同一份 `web/dist` 可以在任意
 * `PUBLIC_BASE_URL` 下服务，不需要为每个实例重新构建页面包。
 *
 * 本地 `vite dev` 由 `web/vite.config.ts` 的代理把 `/api`、`/media` 转给后端；
 * Android WebView 的文档地址是 `APP_API_BASE` 所在源，相对路径同样落到那个源。
 * 如果 API 必须在另一个源，应该在反代上把 `/api`、`/media` 同域转发，而不是把域名
 * 写进页面包（跨源还会额外依赖 CORS 和 WebAuthn 来源配置）。
 */

/** 页面访问 API 的固定同源路径。 */
export const API_BASE = '/api/v1';
