/**
 * 应用和报名站的接口基址。
 *
 * 构建时 `vite.config.ts` 把 `APP_API_BASE` 写进 `VITE_API_BASE`。
 * 报名站和页面同源，继续用相对路径，不读这个值。
 */

const DEV_API_BASE = 'http://127.0.0.1:3000/api/v1';

/** @param surface `VITE_SURFACE`。只有报名站构建是 `join`。 */
export function resolveApiBase(surface: string | undefined, configured: string | undefined): string {
  if (surface === 'join') return '/api/v1';
  const value = configured?.trim().replace(/\/+$/, '') ?? '';
  return value || DEV_API_BASE;
}

/** 站内 `/media/` 要补的源。报名站返回空串，相对路径即可。 */
export function mediaOriginFromApiBase(apiBase: string): string {
  if (apiBase.startsWith('/')) return '';
  try {
    return new URL(apiBase).origin;
  } catch {
    return '';
  }
}
