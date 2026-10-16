/**
 * 把头像和展会媒体的站内路径补成 WebView 能请求到的地址。
 *
 * 页面跑在 `https://appassets.androidplatform.net`，相对路径会打到那个源，而不是后端。
 * 源跟 `APP_API_BASE` 相同。报名站与页面同源，保持相对路径。
 * 已经是绝对地址的原样返回。
 */

import { mediaOriginFromApiBase, resolveApiBase } from './api-base';

const API_ORIGIN = mediaOriginFromApiBase(resolveApiBase(import.meta.env.VITE_SURFACE, import.meta.env.VITE_API_BASE));

export function resolveMediaUrl(src: string, origin = API_ORIGIN): string {
  if (src.startsWith('/media/')) return origin ? `${origin}${src}` : src;
  return src;
}
