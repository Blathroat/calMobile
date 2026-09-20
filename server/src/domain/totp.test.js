/**
 * TOTP 与备用码的单元测试。
 *
 * **RFC 6238 的官方测试向量**是这里最重要的一条：自己实现 OTP 一旦算错，
 * 用户在验证器里看到的码永远对不上，而这类问题在真机上很难自查。
 * 向量取 RFC 6238 附录 B（SHA1，种子 `12345678901234567890`，
 * base32 为 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`）。
 */

const assert = require('node:assert/strict');

const {
  base32Encode, base32Decode, generateSecret, codeFor, verifyCode, otpauthUri,
  encryptionKey, encryptSecret, decryptSecret,
  generateBackupCodes, normalizeBackupCode, isBackupCodeShape, hashBackupCode,
} = require('./totp');

/** RFC 6238 附录 B 的种子（ASCII 的 "12345678901234567890"）。 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** RFC 6238 附录 B 的 8 位向量（时间秒 → 码）。 */
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('base32 往返：编解码互为逆运算，且是大写无填充', () => {
  const buffer = Buffer.from('12345678901234567890', 'ascii');
  const encoded = base32Encode(buffer);
  assert.equal(encoded, RFC_SECRET);
  assert.deepEqual(base32Decode(encoded), buffer);
  // 小写、带空格与横线的输入都要认（用户从二维码旁边手抄时经常这样）
  assert.deepEqual(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), buffer);
});

test('base32 解码遇到非法字符会报错，而不是静默返回半截数据', () => {
  assert.throws(() => base32Decode('ABC1DEF'), /不是合法的 base32 字符/);
});

test('RFC 6238 测试向量全部命中（SHA1 / 8 位）', () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    const actual = codeFor(RFC_SECRET, { at: seconds * 1000, digits: 8 });
    assert.equal(actual, expected, `${seconds}s 的码应当是 ${expected}，实际 ${actual}`);
  }
});

test('6 位码就是 8 位码的后 6 位（默认参数）', () => {
  assert.equal(codeFor(RFC_SECRET, { at: 59000, digits: 6 }), '287082');
  assert.equal(codeFor(RFC_SECRET, { at: 59000 }), '287082', '默认就是 6 位、30 秒一步');
});

test('生成的密钥是 32 个 base32 字符（160 bit）且每次不同', () => {
  const first = generateSecret();
  const second = generateSecret();
  assert.match(first, /^[A-Z2-7]{32}$/);
  assert.notEqual(first, second);
  assert.equal(base32Decode(first).length, 20);
});

test('校验允许 ±1 步的时钟漂移，但不会放行更远的码', () => {
  const at = 1_700_000_000_000;
  const previous = codeFor(RFC_SECRET, { at: at - 30_000 });
  const next = codeFor(RFC_SECRET, { at: at + 30_000 });
  const far = codeFor(RFC_SECRET, { at: at + 90_000 });
  const current = codeFor(RFC_SECRET, { at });

  assert.equal(verifyCode(RFC_SECRET, current, { at }), true, '当前这一步必须通过');
  assert.equal(verifyCode(RFC_SECRET, previous, { at }), true, '上一步要通过（慢 30 秒的手机）');
  assert.equal(verifyCode(RFC_SECRET, next, { at }), true, '下一步要通过（快 30 秒的手机）');
  assert.equal(verifyCode(RFC_SECRET, far, { at }), false, '漂移 90 秒不该放行');
});

test('校验的边界：位数不对、非数字、密钥非法一律为假（不抛异常）', () => {
  const at = 1_700_000_000_000;
  const current = codeFor(RFC_SECRET, { at });
  assert.equal(verifyCode(RFC_SECRET, `${current}0`, { at }), false);
  assert.equal(verifyCode(RFC_SECRET, current.slice(0, 5), { at }), false);
  assert.equal(verifyCode(RFC_SECRET, 'abcdef', { at }), false);
  assert.equal(verifyCode(RFC_SECRET, '', { at }), false);
  assert.equal(verifyCode(RFC_SECRET, undefined, { at }), false);
  // 密钥本身写坏（例如解密失败后传了空串）时不炸：返回假，由上层决定怎么提示
  assert.equal(verifyCode('!!!!', current, { at }), false);
});

test('otpauth URI：验证器 App 要能直接扫，issuer 与账号都在标签里', () => {
  const uri = otpauthUri({ secret: RFC_SECRET, account: 'demo@example.com', issuer: '发现展会' });
  assert.ok(uri.startsWith('otpauth://totp/'), uri);
  assert.ok(uri.includes(encodeURIComponent('发现展会:demo@example.com')), '标签是「发行方:账号」并做过 URL 编码');
  const params = new URL(uri).searchParams;
  assert.equal(params.get('secret'), RFC_SECRET);
  assert.equal(params.get('issuer'), '发现展会');
  assert.equal(params.get('algorithm'), 'SHA1');
  assert.equal(params.get('digits'), '6');
  assert.equal(params.get('period'), '30');
});

test('密钥加密：同样的明文两次得到不同密文，且能解回原文', () => {
  const key = encryptionKey({ TOTP_SECRET_KEY: 'test-key-for-totp-encryption' });
  const first = encryptSecret(RFC_SECRET, key);
  const second = encryptSecret(RFC_SECRET, key);
  assert.notEqual(first, second, '每次都要换 IV，不能是确定性密文');
  assert.ok(first.startsWith('v1:'));
  assert.ok(!first.includes(RFC_SECRET), '密文里不能出现明文密钥');
  assert.equal(decryptSecret(first, key), RFC_SECRET);
  assert.equal(decryptSecret(second, key), RFC_SECRET);
});

test('密钥加密：换密钥或改动密文都会被 GCM 拦下', () => {
  const key = encryptionKey({ TOTP_SECRET_KEY: 'key-one-for-totp' });
  const other = encryptionKey({ TOTP_SECRET_KEY: 'key-two-for-totp' });
  const payload = encryptSecret(RFC_SECRET, key);
  assert.throws(() => decryptSecret(payload, other), /unable to authenticate|bad decrypt/i);

  const parts = payload.split(':');
  const tampered = `${parts[0]}:${parts[1]}:${Buffer.from('tampered').toString('base64url')}`;
  assert.throws(() => decryptSecret(tampered, key));
  assert.throws(() => decryptSecret('not-a-payload', key), /格式不认识/);
  assert.throws(() => decryptSecret('v1:only-two', key), /内容不完整/);
});

test('加密密钥：优先 TOTP_SECRET_KEY，缺省借用 JWT_REFRESH_SECRET；都没有才报错', () => {
  const dedicated = encryptionKey({ TOTP_SECRET_KEY: 'dedicated', JWT_REFRESH_SECRET: 'borrowed' });
  const borrowed = encryptionKey({ JWT_REFRESH_SECRET: 'borrowed' });
  assert.notDeepEqual(dedicated, borrowed, '配了专用密钥就不该再用刷新令牌密钥');
  assert.deepEqual(encryptionKey({ TOTP_SECRET_KEY: 'borrowed' }), borrowed, '派生规则稳定');
  assert.throws(() => encryptionKey({}), /缺少 TOTP 加密密钥/);
});

test('备用码：10 个、五五分组、字符集里没有易混字符、每次不同', () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, 10);
  for (const code of codes) {
    assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/, `备用码形状不对：${code}`);
  }
  assert.notDeepEqual(codes, generateBackupCodes());
});

test('备用码：归一化与形状判定（大小写、多打少打横线都要能对上）', () => {
  const code = generateBackupCodes()[0];
  const raw = code.replace('-', '');
  assert.equal(normalizeBackupCode(code), raw);
  assert.equal(normalizeBackupCode(code.toLowerCase()), raw, '小写也要认');
  assert.equal(normalizeBackupCode(` ${code.slice(0, 5)} - ${code.slice(6)} `), raw);
  assert.equal(hashBackupCode(code), hashBackupCode(raw), '两种写法必须哈希到同一个值');
  assert.equal(hashBackupCode(code), hashBackupCode(code.toLowerCase()));

  assert.equal(isBackupCodeShape(code), true);
  assert.equal(isBackupCodeShape(raw), true, '手抄时丢了横线也要认');
  assert.equal(isBackupCodeShape(code.toLowerCase()), true);
  assert.equal(isBackupCodeShape('123456'), false, '6 位验证码不是备用码');
  assert.equal(isBackupCodeShape('ABCDE-FGHI'), false, '位数不对');
  assert.equal(isBackupCodeShape('ABCDEFGHIJK'), false, '11 位不是备用码');
  assert.equal(isBackupCodeShape(''), false);
});

test('备用码哈希是 sha256 十六进制，且不泄露原文', () => {
  const hash = hashBackupCode('ABCDE-FGHIJ');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes('ABCDE'));
});
