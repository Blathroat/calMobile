/**
 * 展商分享出去的报名链接：`{PUBLIC_BASE_URL}/e/{展会 id}`。
 *
 * 没配对外域名、或域名不是 http(s) 地址时返回空串。调用方据此说明「报名站地址未配置」，
 * 不要自己拼 `127.0.0.1`——那是 App 访问本机 API 的地址，不是给访客打开的链接。
 */
export function registrationLink(publicBaseUrl: unknown, exhibitionId: unknown): string {
  const base = String(publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const id = String(exhibitionId ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(base) || !id) return '';
  return `${base}/e/${encodeURIComponent(id)}`;
}

/** 展商分享的私人会议申请链接：`{PUBLIC_BASE_URL}/m/{展商 id}`。规则与报名链接相同。 */
export function meetingLink(publicBaseUrl: unknown, exhibitorId: unknown): string {
  const base = String(publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const id = String(exhibitorId ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(base) || !id) return '';
  return `${base}/m/${encodeURIComponent(id)}`;
}
