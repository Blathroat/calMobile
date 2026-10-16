/**
 * 把头像和展会媒体的站内路径补成 WebView 能请求到的地址。
 *
 * 应用页面和报名站都开在接口所在的源上，站内 `/media/` 补到这个源。
 * 设备上临时选中的文件仍用 appassets 绝对地址，这里原样返回。
 */

import { mediaOriginFromApiBase, resolveApiBase } from './api-base';

const API_ORIGIN = mediaOriginFromApiBase(resolveApiBase(import.meta.env.VITE_SURFACE, import.meta.env.VITE_API_BASE));

export function resolveMediaUrl(src: string, origin = API_ORIGIN): string {
  if (src.startsWith('/media/')) return origin ? `${origin}${src}` : src;
  return src;
}
