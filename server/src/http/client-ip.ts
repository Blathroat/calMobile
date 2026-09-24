/**
 * 客户端 IP 解析：在 `TRUST_PROXY` 三态下保持稳定的取址语义。
 *
 * 反代信任不能依赖框架上下文，因此这里把 `trust proxy` 的三种取值集中实现
 * （算法与 proxy-addr 的常见语义一致）：
 *
 * - `false`（不信任）：只认 socket 对端地址，X-Forwarded-For 一律不读；
 * - 数字（跳数）：从左起信任前 n 个地址（socket 算第 0 跳），取第一个不受信地址；
 * - 字符串（可信来源）：逗号分隔的 IP / CIDR / `loopback` / `linklocal` / `uniquelocal`，
 *   从左起跳过所有落在这些来源里的地址，取第一个不受信地址。
 *
 * 地址表的顺序与 proxy-addr 一致：`[socket 地址, ...X-Forwarded-For 从右到左]`。
 * 全部信任时返回最左边的 X-Forwarded-For（客户端自己声明的那个值）——这就是
 * 「信任所有人」的代价，与迁移前的行为完全相同。
 */

import type { TrustProxy } from '../config/runtime.js';

/** 解析一次请求需要的输入：socket 对端地址 + X-Forwarded-For 原值。 */
export interface ClientIpRequest {
  remoteAddress?: string;
  forwardedFor?: string;
}

type IpKind = 'ipv4' | 'ipv6';

interface IpAddress {
  kind: IpKind;
  /** 32 位（IPv4）或 128 位（IPv6）的 BigInt 形式，便于按前缀比较。 */
  value: bigint;
}

interface Subnet {
  kind: IpKind;
  network: bigint;
  prefix: number;
}

/** 编译出来的信任函数：地址表中的第 index 个地址是否可信。 */
export interface TrustFunction {
  (address: string, index: number): boolean;
}

/** `loopback` 之类的名字：与 proxy-addr 的 IP_RANGES 完全一致。 */
const NAMED_RANGES: Record<string, readonly string[]> = {
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  loopback: ['127.0.0.1/8', '::1/128'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

/** 预定义范围展开后按来源缓存，避免每个请求重新解析 CIDR。 */
const compiledTrust = new Map<string, TrustFunction>();

/**
 * 解析 IPv4 点分十进制；非法时给 undefined。
 *
 * 不接受 `1.2.3`（缺段）与 `1.2.3.4.5`（多段），段宽 1–3 且 ≤255，与 ipaddr.js 的宽松度一致。
 */
function parseIpv4(text: string): bigint | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

/** 把 8 个 16 位段拼成 128 位整数；任一段非法即 undefined。 */
function packIpv6(groups: readonly string[]): bigint | undefined {
  if (groups.length !== 8) {
    return undefined;
  }
  let value = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP.test(group)) {
      return undefined;
    }
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** 解析 IPv6（含 `::` 压缩与 `::ffff:1.2.3.4` 的 IPv4 尾巴）。 */
function parseIpv6(text: string): bigint | undefined {
  let body = text.toLowerCase().replace(/^\[|\]$/g, '');
  const lastColon = body.lastIndexOf(':');
  const tail = body.slice(lastColon + 1);
  if (tail.includes('.')) {
    const ipv4 = parseIpv4(tail);
    if (ipv4 === undefined) {
      return undefined;
    }
    //  IPv4 尾巴换成两个 16 位段（要显式 toString(16)：BigInt 的默认字符串是十进制，
    //  再被按十六进制解析一次就错了）
    body = `${body.slice(0, lastColon + 1)}${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(body)) {
    return undefined;
  }
  const halves = body.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (halves.length === 1) {
    return packIpv6(head);
  }
  if (head.length + tailGroups.length > 8) {
    return undefined;
  }
  const missing = 8 - head.length - tailGroups.length;
  const filler: string[] = Array.from({ length: missing }, () => '0');
  return packIpv6([...head, ...filler, ...tailGroups]);
}

function parseAddress(text: string): IpAddress | undefined {
  const value = parseIpv4(text) ?? parseIpv6(text);
  if (value === undefined) {
    return undefined;
  }
  return { kind: text.includes(':') ? 'ipv6' : 'ipv4', value };
}

/**
 * IPv4-mapped 地址（`::ffff:1.2.3.4`）规范成 IPv4。
 *
 * 与 proxy-addr 的跨族守卫一致：只有映射地址能跨族比较，原生 IPv6 不能命中 IPv4 子网。
 */
function canonicalize(address: IpAddress): IpAddress {
  if (address.kind === 'ipv6' && address.value >> 32n === 0xffffn) {
    return { kind: 'ipv4', value: address.value & 0xffffffffn };
  }
  return address;
}

function inSubnet(address: IpAddress, subnet: Subnet): boolean {
  const candidate = canonicalize(address);
  if (candidate.kind !== subnet.kind) {
    return false;
  }
  const bits = BigInt(subnet.kind === 'ipv4' ? 32 : 128);
  const shift = bits - BigInt(subnet.prefix);
  return candidate.value >> shift === subnet.network >> shift;
}

/**
 * 把 `255.255.240.0` 这样的子网掩码换成前缀长度（数前导 1）。
 *
 * proxy-addr 的 `parseNetmask` 支持这个记法，`TRUST_PROXY=10.0.0.0/255.0.0.0` 因此
 * 是合法配置；不支持它会让每个请求都在算 IP 时抛错。
 */
function netmaskToPrefix(mask: string): number | undefined {
  const parsed = parseIpv4(mask);
  if (parsed === undefined) {
    return undefined;
  }
  // 从最高位往下数连续的 1：不连续（如 255.0.255.0）不是掩码
  let prefix = 0;
  for (let bit = 31n; bit >= 0n; bit -= 1n) {
    if ((parsed >> bit) & 1n) {
      prefix += 1;
      continue;
    }
    break;
  }
  if (prefix === 0) {
    return undefined;
  }
  // 数到的前缀必须能拼回同一个掩码，借此挡住「255.0.0.255」这类中间断开的
  const expected = ((1n << BigInt(prefix)) - 1n) << BigInt(32 - prefix);
  return parsed === expected ? prefix : undefined;
}

/**
 * 解析来源声明：`1.2.3.4`、`10.0.0.0/8`、`10.0.0.0/255.0.0.0`、`fe80::/10`。
 *
 * 前缀既接受数字（CIDR）也接受 IPv4 掩码，与 proxy-addr 的两条路一致。
 */
function parseSubnet(note: string): Subnet {
  const slash = note.lastIndexOf('/');
  const host = slash === -1 ? note : note.slice(0, slash);
  const address = parseAddress(host);
  if (!address) {
    throw new TypeError(`TRUST_PROXY 里不是合法的 IP 地址：${host}`);
  }
  const max = address.kind === 'ipv4' ? 32 : 128;
  if (slash === -1) {
    return { kind: address.kind, network: address.value, prefix: max };
  }
  const notation = note.slice(slash + 1).trim();
  const numeric = /^\d+$/.test(notation) ? Number(notation) : undefined;
  const prefix = numeric ?? (address.kind === 'ipv4' ? netmaskToPrefix(notation) : undefined);
  if (!Number.isInteger(prefix) || (prefix as number) <= 0 || (prefix as number) > max) {
    throw new TypeError(`TRUST_PROXY 里的前缀长度不合法：${note}`);
  }
  return { kind: address.kind, network: address.value, prefix: prefix as number };
}

/**
 * 在启动时编译一次：写错的 `TRUST_PROXY` 应当让进程起不来，而不是让之后每个请求
 * 全都 500（算 IP 在请求路径上，出错没有第二次机会）。
 *
 * 语义按常见反代信任规则逐分支对齐：
 * 数字 → 跳数；字符串 → 逗号分隔的来源列表；其余（含空串）→ 谁也不信。
 */
export function ensureTrustProxy(trust: TrustProxy): TrustFunction {
  return compileTrustProxy(trust);
}

function compileTrustProxy(trust: TrustProxy): TrustFunction {
  const key = JSON.stringify(trust);
  const cached = compiledTrust.get(key);
  if (cached) {
    return cached;
  }
  const compiled = buildTrustFunction(trust);
  compiledTrust.set(key, compiled);
  return compiled;
}

function buildTrustFunction(trust: TrustProxy): TrustFunction {
  // 没有「信任一切」这一档：那会让客户端用自己的 X-Forwarded-For 任意指定身份，
  // 与「不信任」一样是被刻意排除的取值，因此这里只处理三态。
  if (typeof trust === 'number') {
    const hops = Math.max(0, Math.floor(trust));
    return (_address, index) => index < hops;
  }
  if (typeof trust === 'string') {
    const notes: string[] = [];
    for (const item of trust.split(',')) {
      const note = item.trim();
      if (!note) {
        continue;
      }
      const range = NAMED_RANGES[note];
      if (range) {
        notes.push(...range);
      } else {
        notes.push(note);
      }
    }
    if (notes.length === 0) {
      return () => false;
    }
    const subnets = notes.map(parseSubnet);
    return (address) => {
      const parsed = parseAddress(address);
      if (!parsed) {
        return false;
      }
      return subnets.some((subnet) => inSubnet(parsed, subnet));
    };
  }
  return () => false;
}

/**
 * 解析 X-Forwarded-For：按逗号切开、去空白，返回**从右到左**的地址表。
 *
 * 顺序与 proxy-addr 的 `forwarded` 包一致：最右边的是最近一个代理追加的那条。
 */
export function parseForwardedFor(header: string | undefined): string[] {
  if (!header) {
    return [];
  }
  return header
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .reverse();
}

/**
 * 取这次请求的客户端 IP。
 *
 * @param request socket 对端地址与 X-Forwarded-For 原值
 * @param trust    `TRUST_PROXY` 的取值（Runtime.trustProxy）
 */
export function clientIp(request: ClientIpRequest, trust: TrustProxy | TrustFunction): string {
  const addresses = [request.remoteAddress ?? '', ...parseForwardedFor(request.forwardedFor)];
  const trustFn = typeof trust === 'function' ? trust : compileTrustProxy(trust);
  for (let index = 0; index < addresses.length - 1; index += 1) {
    if (trustFn(addresses[index]!, index)) {
      continue;
    }
    addresses.length = index + 1;
    break;
  }
  return addresses[addresses.length - 1] ?? '';
}
