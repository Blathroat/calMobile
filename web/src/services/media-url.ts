/**
 * 把头像和展会媒体的站内路径补成 WebView 能请求到的地址。
 *
 * 应用页面、PWA 与报名站都和接口同源，站内 `/media/` 保持相对路径即可；
 * 页面包不带域名，部署到哪个实例就请求哪个实例。设备上临时选中的文件用的是
 * `appassets` 绝对地址，这里原样返回。
 */

/** 默认不补源：媒体走页面当前 origin。 */
const API_ORIGIN = '';

export function resolveMediaUrl(src: string, origin = API_ORIGIN): string {
  if (src.startsWith('/media/')) return origin ? `${origin}${src}` : src;
  return src;
}
