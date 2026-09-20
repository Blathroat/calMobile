/**
 * 验证码的纯函数单测：码的形态、哈希与等长比较、邮箱归一化、以及几个关键阈值。
 *
 * 需要数据库的那部分（签发、限流计数、原子消费）在 `server/test/api.test.js` 里按 HTTP 走 ——
 * 那些行为的正确性取决于真实的行数与并发，打桩反而测不出东西。
 */

const assert = require('node:assert/strict');

const {
  CODE_TTL_MIN, CODE_LENGTH, MAX_ATTEMPTS, RESEND_COOLDOWN_SEC,
  SEND_PER_HOUR, SEND_PER_DAY, IP_SEND_PER_HOUR,
  normalizeEmail, hashCode, sameHash, generateCode,
} = require('./otp');

test('验证码是 6 位数字，含前导零', () => {
  for (let i = 0; i < 500; i += 1) {
    const code = generateCode();
    assert.match(code, /^\d{6}$/, `生成的不是 6 位数字：${code}`);
  }
  assert.equal(CODE_LENGTH, 6);
});

test('码不会总是同一个（随机源真的在动）', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    seen.add(generateCode());
  }
  assert.ok(seen.size > 40, `50 次里只有 ${seen.size} 个不同的码，随机性可疑`);
});

test('哈希与行 id 绑定：同一个码在不同记录里哈希不同', () => {
  const a = hashCode('123456', 'code-a');
  const b = hashCode('123456', 'code-b');
  assert.notEqual(a, b, '同一个码在不同 id 下必须得到不同哈希（id 就是盐）');
  assert.equal(a, hashCode('123456', 'code-a'), '同一入参必须稳定');
  assert.equal(a.length, 64, 'sha256 的十六进制是 64 个字符');
  assert.ok(!a.includes('123456'), '哈希里不能出现明文码');
});

test('等长比较：相等为真，不等 / 空值 / 长度不同一律为假', () => {
  const hash = hashCode('123456', 'code-a');
  assert.equal(sameHash(hash, hash), true);
  assert.equal(sameHash(hash, hashCode('123457', 'code-a')), false);
  assert.equal(sameHash(hash, hash.slice(0, 63)), false, '长度不同不能抛异常，要判否');
  assert.equal(sameHash('', ''), false);
  assert.equal(sameHash(null, hash), false);
});

test('邮箱归一化：去空白 + 转小写（大小写不同的邮箱是同一个邮箱）', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(null), '');
});

test('阈值就是文档里写的那些（改动要同步邮件文案与 README）', () => {
  assert.equal(CODE_TTL_MIN, 10);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(RESEND_COOLDOWN_SEC, 60);
  assert.equal(SEND_PER_HOUR, 5);
  assert.equal(SEND_PER_DAY, 15);
  assert.equal(IP_SEND_PER_HOUR, 20);
  // 24 小时上限必须大于 1 小时上限，否则「一天 15 条」永远达不到
  assert.ok(SEND_PER_DAY > SEND_PER_HOUR);
});
