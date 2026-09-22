/**
 * 客户端 IP 的三态取址。
 *
 * 用例全部对着 proxy-addr / express 的行为钉死：反代跳数错一位，按 IP 的验证码限流
 * 就会退化成「全体用户共用一个额度」；反过来在直连场景信任过头，客户端就能伪造
 * X-Forwarded-For 绕过限流。这两头都靠这里的断言看着。
 *
 * 用 vitest 全局的 test（与 src 下其它用例一致，由 `pnpm test` 驱动），断言语义来自
 * `node:assert/strict`，不绑死 vitest 的 expect API。
 */

import assert from 'node:assert/strict';
import { clientIp, ensureTrustProxy, parseForwardedFor } from './client-ip.js';
import type { TrustProxy } from '../config/runtime.js';

test('parseForwardedFor 从右到左返回地址，丢掉空白段', () => {
  assert.deepEqual(parseForwardedFor('203.0.113.7, 10.0.0.4'), ['10.0.0.4', '203.0.113.7']);
  assert.deepEqual(parseForwardedFor('203.0.113.7'), ['203.0.113.7']);
  assert.deepEqual(parseForwardedFor('  '), []);
  assert.deepEqual(parseForwardedFor(undefined), []);
});

test('不信任代理：只认 socket 地址，X-Forwarded-For 一律不读', () => {
  const trust: TrustProxy = false;
  assert.equal(clientIp({ remoteAddress: '10.0.0.1', forwardedFor: '203.0.113.7' }, trust), '10.0.0.1');
  assert.equal(clientIp({ remoteAddress: '10.0.0.1', forwardedFor: '203.0.113.7, 8.8.8.8' }, trust), '10.0.0.1');
  // 伪造的 X-Forwarded-For 也不能把自己改成客户端
  assert.equal(clientIp({ remoteAddress: '127.0.0.1', forwardedFor: '1.1.1.1' }, trust), '127.0.0.1');
});

test('按跳数信任：跳数一位都不能错', () => {
  // 一级代理：socket 是代理，最右边那条才是客户端
  assert.equal(clientIp({ remoteAddress: '10.0.0.9', forwardedFor: '203.0.113.7' }, 1), '203.0.113.7');
  // 两级代理：信任一个跳时拿到中间的代理，信任两个跳才看到真正的客户端
  const chained = { remoteAddress: '10.0.0.9', forwardedFor: '203.0.113.7, 10.0.0.4' };
  assert.equal(clientIp(chained, 1), '10.0.0.4');
  assert.equal(clientIp(chained, 2), '203.0.113.7');
  // 信任过头（3 跳）会拿到客户端自己声明的值：跳数必须与真实拓扑一致
  assert.equal(clientIp(chained, 3), '203.0.113.7');
  // 没有 X-Forwarded-For 时退回 socket 地址
  assert.equal(clientIp({ remoteAddress: '10.0.0.9', forwardedFor: undefined }, 1), '10.0.0.9');
});

test('按来源信任：跳过落在可信来源里的地址', () => {
  assert.equal(clientIp({ remoteAddress: '127.0.0.1', forwardedFor: '203.0.113.7' }, 'loopback'), '203.0.113.7');
  assert.equal(clientIp({ remoteAddress: '192.168.1.1', forwardedFor: '203.0.113.7' }, 'uniquelocal'), '203.0.113.7');
  assert.equal(
    clientIp({ remoteAddress: '172.16.0.1', forwardedFor: '203.0.113.7' }, 'loopback, 172.16.0.0/12'),
    '203.0.113.7',
  );
});

test('按来源信任：遇到第一个不可信地址就停', () => {
  const chained = { remoteAddress: '10.0.0.1', forwardedFor: '203.0.113.7, 10.0.0.4' };
  // 整段 10/8 都可信 → 客户端是最左边的 203.0.113.7
  assert.equal(clientIp(chained, '10.0.0.0/8'), '203.0.113.7');
  // 只信任中间那一个点 → 10.0.0.1 不可信，客户端就是它
  assert.equal(clientIp(chained, '10.0.0.4'), '10.0.0.1');
});

test('按来源信任：IPv6 掩码、linklocal 与掩码记法都能用', () => {
  // fd00::/8 覆盖 fd12:3456::1
  assert.equal(clientIp({ remoteAddress: 'fd12:3456::1', forwardedFor: '203.0.113.7' }, 'fd00::/8'), '203.0.113.7');
  // linklocal 覆盖 169.254.0.0/16
  assert.equal(clientIp({ remoteAddress: '169.254.20.5', forwardedFor: '203.0.113.7' }, 'linklocal'), '203.0.113.7');
  // 掩码记法：10.0.0.0/255.0.0.0 与 10.0.0.0/8 等价（Express 也支持）
  assert.equal(
    clientIp({ remoteAddress: '10.0.0.1', forwardedFor: '203.0.113.7' }, '10.0.0.0/255.0.0.0'),
    '203.0.113.7',
  );
  assert.equal(
    clientIp({ remoteAddress: '11.0.0.1', forwardedFor: '203.0.113.7' }, '10.0.0.0/255.0.0.0'),
    '11.0.0.1',
    '掩码之外的地址不可信',
  );
  // 不连续的掩码不是合法来源，要响亮地拒绝
  assert.throws(() => clientIp({ remoteAddress: '10.0.0.1' }, '10.0.0.0/255.0.255.0'), /TRUST_PROXY/);
});

test('IPv4-mapped 地址能命中 IPv4 来源，原生 IPv6 不能', () => {
  assert.equal(
    clientIp({ remoteAddress: '::ffff:10.0.0.1', forwardedFor: '203.0.113.7' }, '10.0.0.0/8'),
    '203.0.113.7',
  );
  assert.equal(clientIp({ remoteAddress: 'fd00::1', forwardedFor: '203.0.113.7' }, '10.0.0.0/8'), 'fd00::1');
});

test('ensureTrustProxy：写错的来源在启动时就炸，不拖到请求期', () => {
  assert.equal(typeof ensureTrustProxy(false), 'function');
  assert.equal(typeof ensureTrustProxy(2), 'function');
  assert.equal(typeof ensureTrustProxy('loopback'), 'function');
  assert.throws(() => ensureTrustProxy('10.0.0.1/33'), /TRUST_PROXY/);
  assert.throws(() => ensureTrustProxy('not-an-ip'), /TRUST_PROXY/);
  assert.throws(() => ensureTrustProxy('10.0.0.0/255.0.0.255'), /TRUST_PROXY/);
});

test('来源声明写错了要炸，而不是静默地信任一切', () => {
  assert.throws(() => clientIp({ remoteAddress: '10.0.0.1' }, 'not-an-ip'), /TRUST_PROXY/);
  assert.throws(() => clientIp({ remoteAddress: '10.0.0.1' }, '10.0.0.0/99'), /TRUST_PROXY/);
  // 空串等价于「不信任」，不会抛
  assert.equal(clientIp({ remoteAddress: '10.0.0.1', forwardedFor: '1.1.1.1' }, ''), '10.0.0.1');
});
