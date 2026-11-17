/**
 * IP 归属地解析的单测。
 *
 * 覆盖三块：
 * 1. `formatRegion()` 的纯格式化（中国去国家、直辖市省市去重、非中国带国家、内网归一）；
 * 2. `isPrivateIpv4()` 的网段判断（回环 / 私网 / 链路本地 / CGNAT / 组播 / 保留）；
 * 3. `lookupIpRegion()` 的兜底（私网给「内网」，IPv6 / 非法 / 空给空串，真实公网 IP 有地区）。
 *
 * 只有第 3 条依赖随包安装的离线 xdb，不联网；公网 IP 的断言只要求非空且不是「内网」，
 * 不断言具体省市，避免以后升级 xdb 时测试跟着数据漂移。
 */
import assert from 'node:assert/strict';
import { formatRegion, isPrivateIpv4, lookupIpRegion, PRIVATE_REGION } from './ip-region.js';

// ── formatRegion ────────────────────────────────────────────────

test('formatRegion 中国境内去掉国家，省与市拼在一起', () => {
  assert.strictEqual(formatRegion('中国|0|江苏省|苏州市|电信'), '江苏省苏州市');
  assert.strictEqual(formatRegion('中国|0|广东省|广州市|电信'), '广东省广州市');
});

test('formatRegion 直辖市的省已包含在市里时只留市', () => {
  assert.strictEqual(formatRegion('中国|0|北京|北京市|联通'), '北京市');
  assert.strictEqual(formatRegion('中国|0|上海|上海市|联通'), '上海市');
  // 省市完全相同时取一个
  assert.strictEqual(formatRegion('中国|0|江苏省|江苏省|电信'), '江苏省');
  // 市包含省、省更长时取省
  assert.strictEqual(formatRegion('中国|0|内蒙古自治区|内蒙古|电信'), '内蒙古自治区');
});

test('formatRegion 只有省或只有市时单独展示', () => {
  assert.strictEqual(formatRegion('中国|0|辽宁省|0|联通'), '辽宁省');
  assert.strictEqual(formatRegion('中国|0|0|苏州市|电信'), '苏州市');
  // 中国但没有任何省市：不硬编一个「中国」
  assert.strictEqual(formatRegion('中国|0|0|0|0'), '');
});

test('formatRegion 非中国展示国家加地区', () => {
  assert.strictEqual(formatRegion('美国|0|0|0|Level3'), '美国');
  assert.strictEqual(formatRegion('美国|0|华盛顿|雷德蒙德|微软'), '美国华盛顿雷德蒙德');
  // 国家就是省市时避免重复
  assert.strictEqual(formatRegion('新加坡|0|新加坡|新加坡|新加坡电信'), '新加坡');
});

test('formatRegion 把内网标记归一成「内网」', () => {
  assert.strictEqual(formatRegion('0|0|0|内网IP|内网IP'), PRIVATE_REGION);
  // 有些保留地址只在内网字段里带标记，运营商字段是正常值
  assert.strictEqual(formatRegion('0|0|0|内网IP|TPG电信'), PRIVATE_REGION);
});

test('formatRegion 空值与解析不出来的串给空串', () => {
  for (const raw of ['', '   ', null, undefined, 'garbage', '中国|0']) {
    assert.strictEqual(formatRegion(raw), '', `输入 ${JSON.stringify(raw)} 应当给空串`);
  }
  // 国家字段是占位 0 时也认为没有数据
  assert.strictEqual(formatRegion('0|0|0|0|0'), '');
});

// ── isPrivateIpv4 ───────────────────────────────────────────────

test('isPrivateIpv4 认得回环、私网、链路本地与 CGNAT', () => {
  for (const ip of [
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '198.18.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.strictEqual(isPrivateIpv4(ip), true, `${ip} 应当算非公网`);
  }
});

test('isPrivateIpv4 不把公网地址与相邻段误判', () => {
  for (const ip of ['8.8.8.8', '218.4.167.70', '172.32.0.1', '192.169.0.1', '100.128.0.1', '223.5.5.5']) {
    assert.strictEqual(isPrivateIpv4(ip), false, `${ip} 是公网地址`);
  }
  for (const ip of ['::1', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', '']) {
    assert.strictEqual(isPrivateIpv4(ip), false, `${ip} 不是 IPv4，不归私网判断`);
  }
});

// ── lookupIpRegion ──────────────────────────────────────────────

test('lookupIpRegion 私网与回环（含 IPv6 写法）给「内网」', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.1.1', '::1', '::ffff:127.0.0.1']) {
    assert.strictEqual(await lookupIpRegion(ip), PRIVATE_REGION, `${ip} 应当显示内网`);
  }
});

test('lookupIpRegion IPv6、非法地址与空值给空串', async () => {
  for (const ip of ['2001:db8::1', 'fe80::1', 'not-an-ip', '1.2.3', '', null, undefined]) {
    assert.strictEqual(await lookupIpRegion(ip), '', `输入 ${String(ip)} 应当给空串`);
  }
});

test('lookupIpRegion 查得到公网 IP 的地区（断言宽松，不锁省市数据）', async () => {
  // 218.4.167.70 是 xdb 里的江苏苏州电信；升级数据后省市可能变，只要求有地区且不是内网。
  const region = await lookupIpRegion('218.4.167.70');
  assert.notStrictEqual(region, '', '公网 IP 应当解析出地区');
  assert.notStrictEqual(region, PRIVATE_REGION, '公网 IP 不该被当成内网');
  assert.ok(!region.includes('|'), '下发的地区不该带 ip2region 的原始分隔符');
  assert.ok(!region.includes('内网IP'), '内网标记不该漏到页面文案里');
  // Node 双栈监听把 IPv4 报成 ::ffff:1.2.3.4 时也要能解析
  assert.strictEqual(await lookupIpRegion('::ffff:218.4.167.70'), region);
});

test('lookupIpRegion 多次调用只加载一次 xdb，结果稳定', async () => {
  const first = await lookupIpRegion('223.5.5.5');
  const second = await lookupIpRegion('223.5.5.5');
  assert.strictEqual(first, second, '同一 IP 的解析结果应当稳定（向量索引是单例）');
});
