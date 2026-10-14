/**
 * 把头像的站内路径补成 WebView 能请求到的地址。
 *
 * 页面跑在 `https://appassets.androidplatform.net`，相对路径会打到那个源，而不是后端。
 * 接口基址写死 `http://127.0.0.1:3000`（模拟器靠 adb reverse 回到本机），这里用同一个源。
 * 已经是绝对地址或设备私有目录地址的，原样返回。
 */

/** 报名站与页面同源，相对路径即可。App 仍补上 WebView 访问不到的本机源。 */
const API_ORIGIN = import.meta.env.VITE_SURFACE === 'join' ? '' : 'http://127.0.0.1:3000';

export function resolveMediaUrl(src: string): string {
  if (src.startsWith('/media/')) return API_ORIGIN ? `${API_ORIGIN}${src}` : src;
  return src;
}
