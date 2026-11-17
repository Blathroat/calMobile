/**
 * IP 归属地：把登录请求的客户端 IP 解析成给用户看的省 / 市。
 *
 * 用 `ip2region-ts` 自带的离线 xdb（随包安装，不联网、不需要额外服务）。
 * 三个约束：
 *
 * 1. **只解析、只存地区**：管理员用户列表只下发 `last_login_region`，IP 原文只留在库里
 *    （`users.last_login_ip`）供排查用，不出现在任何响应里。
 * 2. **懒加载**：xdb 的向量索引有几百 KB，进程启动时不读，第一次有登录成功才读一次；
 *    读失败也只试一次，不让每个登录都去碰文件系统。
 * 3. **失败不影响登录**：IPv6、非法地址、私网、查不到、xdb 读不出来——全部给空串或
 *    「内网」，不抛错；调用方（登录 / 注册）只当它是展示字段。
 *
 * 地区串的原始形状是 `国家|区域码|省|市|运营商`（例如 `中国|0|江苏省|苏州市|电信`），
 * 格式化成页面上要的「江苏省苏州市」由 `formatRegion()` 负责。
 */

import { defaultDbFile, isValidIp, loadVectorIndexFromFile, newWithVectorIndex } from 'ip2region-ts';

type Searcher = ReturnType<typeof newWithVectorIndex>;

/** 懒加载的单例：首次查询时才读向量索引。 */
let searcher: Searcher | null = null;

/** 加载失败只试一次；否则 xdb 缺失时每次登录都会读一次文件再失败。 */
let loadFailed = false;

/** 私网 / 回环 / 保留地址的统一文案（页面上就显示这两个字）。 */
export const PRIVATE_REGION = '内网';

function getSearcher(): Searcher | null {
  if (searcher) {
    return searcher;
  }
  if (loadFailed) {
    return null;
  }
  try {
    // 只缓存向量索引（约 500 KB），xdb 正文仍按偏移读文件；比把 11 MB 全读进内存省得多。
    searcher = newWithVectorIndex(defaultDbFile, loadVectorIndexFromFile(defaultDbFile));
  } catch (error: unknown) {
    loadFailed = true;
    console.warn('加载 IP 归属地库失败，最近登录地区将为空：', error instanceof Error ? error.message : String(error));
  }
  return searcher;
}

/** 把 IPv4 点分十进制换成 32 位整数；非法给 null。 */
function ipv4ToInt(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value;
}

/**
 * 不该去公网库里查的 IPv4：回环、私网、链路本地、运营商级 NAT、
 * 组播与保留段，以及网络设备基准测试段。
 *
 * 这些地址在 xdb 里大多也标成「内网IP」，但那是数据里的巧合；
 * 先按网段判掉，查库前就返回「内网」，既快也不依赖数据版本。
 * 文档 / 测试网段（192.0.2.0/24、198.51.100.0/24、203.0.113.0/24）不在这里列，
 * xdb 同样会给「内网IP」，由 `formatRegion()` 归一。
 */
export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip.trim());
  if (value === null) {
    return false;
  }
  const first = Math.floor(value / 256 ** 3);
  const second = Math.floor(value / 256 ** 2) % 256;
  // 0.0.0.0/8（含未指定地址）、10.0.0.0/8、127.0.0.0/8
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  // 100.64.0.0/10：运营商级 NAT，不和公网互通
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  // 169.254.0.0/16：链路本地
  if (first === 169 && second === 254) {
    return true;
  }
  // 172.16.0.0/12
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  // 192.168.0.0/16
  if (first === 192 && second === 168) {
    return true;
  }
  // 198.18.0.0/15：网络设备基准测试段
  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }
  // 224.0.0.0/4 组播 + 240.0.0.0/4 保留（含广播地址）
  return first >= 224;
}

/**
 * 原始地区串 → 页面上的地区文案。
 *
 * - 中国境内去掉国家，拼成「江苏省苏州市」；直辖市的省是「北京」、市是「北京市」，
 *   市已经包含省时只留市，避免「北京北京市」。
 * - 非中国：国家 + 有值的省 / 市，例如 `美国|0|0|0|Level3` → 「美国」、
 *   `美国|0|华盛顿|雷德蒙德|微软` → 「美国华盛顿雷德蒙德」。
 * - 任何一段是「内网IP」（xdb 对保留地址给的就是这个）归一成「内网」。
 * - 空串 / 段数不对 / 只有占位 `0` → 空串，页面只显示日期。
 */
export function formatRegion(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }
  const parts = text.split('|').map((part) => part.trim());
  if (parts.length < 4) {
    return '';
  }
  if (parts.some((part) => part === '内网IP')) {
    return PRIVATE_REGION;
  }
  /** 占位段 `0` 当没有数据。 */
  const useful = (part: string | undefined): string => (part && part !== '0' ? part : '');
  const country = useful(parts[0]);
  const province = useful(parts[2]);
  const city = useful(parts[3]);
  // 省市互相包含时取更长的那个：北京 + 北京市 → 北京市，江苏省 + 江苏省 → 江苏省。
  const area =
    province && city
      ? city.startsWith(province) || province.startsWith(city)
        ? city.length >= province.length
          ? city
          : province
        : `${province}${city}`
      : province || city;
  if (!country) {
    return '';
  }
  if (country === '中国') {
    return area;
  }
  return country === province || country === city ? area : `${country}${area}`;
}

/**
 * 客户端地址规范化：去空白与方括号，IPv4-mapped 的 IPv6 还原成 IPv4。
 *
 * Node 的双栈监听会把 IPv4 客户端报成 `::ffff:1.2.3.4`，它本质仍是 IPv4，
 * 不还原的话页面永远拿不到地区。zone 后缀（`%eth0`）也一并去掉。
 */
function normalizeAddress(ip: string | null | undefined): string {
  const text = String(ip ?? '')
    .trim()
    .replace(/^\[|\]$/g, '');
  const withoutZone = text.split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(withoutZone);
  return mapped ? mapped[1]! : withoutZone;
}

/**
 * 查询 IP 归属地（给用户看的地区文案）。
 *
 * 私网 / 回环（含 `::1`）→「内网」；IPv6、非法地址、查不到、xdb 异常 → 空串。
 * 永不抛错：登录与注册把它当纯展示字段，地区丢了也不能让登录失败。
 */
export async function lookupIpRegion(ip: string | null | undefined): Promise<string> {
  const address = normalizeAddress(ip);
  if (!address) {
    return '';
  }
  if (address === '::1' || isPrivateIpv4(address)) {
    return PRIVATE_REGION;
  }
  // xdb 只支持 IPv4：IPv6 与非法地址直接空串，不依赖库内部抛错的文案。
  if (!isValidIp(address)) {
    return '';
  }
  try {
    const found = getSearcher();
    if (!found) {
      return '';
    }
    const result = await found.search(address);
    return formatRegion(result.region);
  } catch {
    return '';
  }
}
