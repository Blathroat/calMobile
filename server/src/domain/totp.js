/**
 * TOTP（RFC 6238）与备用码的底层实现。
 *
 * 自己实现而不是引依赖：只要 HMAC-SHA1 + base32 两件事，`node:crypto` 全都有，
 * 而第三方 OTP 库往往把「生成二维码、校验、恢复码」连带一堆用不到的东西一起带进来。
 * 代价是必须自己对着 **RFC 6238 的官方测试向量**写用例（见 totp.test.js）——
 * 这块代码算错一个 bit，用户就会遇到「验证器里的码永远不对」这种没法自查的问题。
 *
 * 三件事在这里一次做完：
 * 1. 验证器（TOTP）：密钥是 base32、6 位码、30 秒一步；
 * 2. 密钥**加密存储**：数据库里的 `totp_secret` 是 AES-256-GCM 密文，不是明文 base32 ——
 *    备份、`pg_dump`、只读副本这类「只有库」的泄露不该直接把第二因子送出去；
 * 3. 备用码：10 个一次性码，只存 sha256 哈希（高熵随机串，不需要 bcrypt 那种慢哈希）。
 */

const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 备用码字符集：去掉 0/O/1/I 这些抄下来容易看错的字符。 */
const BACKUP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const DEFAULT_STEP_SEC = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;
const SECRET_BYTES = 20;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_CHARS = 10;
const ENCRYPTION_PREFIX = 'v1:';

/** 备用码的书写形态：五 + 五，中间一个横线。 */
const BACKUP_CODE_PATTERN = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;

// ── base32（RFC 4648，无填充） ────────────────────────────────────

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(text) {
  const clean = String(text === undefined || text === null ? '' : text)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`不是合法的 base32 字符：${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── TOTP ─────────────────────────────────────────────────────────

/** HOTP：HMAC-SHA1 + 动态截断（RFC 4226）。 */
function hotp(secretBuffer, counter, digits = DEFAULT_DIGITS) {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', secretBuffer).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** 等长比较，避免按字符提前返回带来的时间差。 */
function sameText(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** 生成一个新密钥（160 bit，与 Google Authenticator 等的默认一致）。 */
function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

/** 某个时刻的验证码。 */
function codeFor(secret, options = {}) {
  const { at = Date.now(), step = DEFAULT_STEP_SEC, digits = DEFAULT_DIGITS } = options;
  const counter = Math.floor(at / 1000 / step);
  return hotp(base32Decode(secret), counter, digits);
}

/**
 * 校验验证码。
 *
 * `window` 默认 ±1 步：客户端与服务器的时钟很难完全对齐，
 * 不放宽会让「刚同步过手机时间」的用户莫名其妙进不去。
 */
function verifyCode(secret, code, options = {}) {
  const {
    at = Date.now(), step = DEFAULT_STEP_SEC, digits = DEFAULT_DIGITS, window = DEFAULT_WINDOW,
  } = options;
  const candidate = String(code === undefined || code === null ? '' : code).replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) {
    return false;
  }
  let secretBuffer;
  try {
    secretBuffer = base32Decode(secret);
  } catch (error) {
    return false;
  }
  const counter = Math.floor(at / 1000 / step);
  for (let offset = -window; offset <= window; offset += 1) {
    if (sameText(hotp(secretBuffer, counter + offset, digits), candidate)) {
      return true;
    }
  }
  return false;
}

/** 验证器 App 扫码用的 otpauth URI。 */
function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: String(secret),
    issuer: String(issuer),
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── 密钥的加密存储 ───────────────────────────────────────────────

/**
 * 加密密钥：优先 `TOTP_SECRET_KEY`，否则借用 `JWT_REFRESH_SECRET` 派生。
 *
 * **换掉这个值会让已绑定的验证器解不开**（路由会把这种情况变成「请重新绑定」而不是 500），
 * 所以生产环境建议单独配 `TOTP_SECRET_KEY` 并把它当长期密钥保管。
 * 延迟到调用时才读环境变量，测试因此可以直接改 `process.env`。
 */
function encryptionKey(env = process.env) {
  const raw = String(env.TOTP_SECRET_KEY || '').trim() || String(env.JWT_REFRESH_SECRET || '').trim();
  if (!raw) {
    throw new Error('缺少 TOTP 加密密钥：请配置 TOTP_SECRET_KEY（或至少保证 JWT_REFRESH_SECRET 存在）');
  }
  return crypto.createHash('sha256').update(`calmobile-totp:${raw}`).digest();
}

/** 明文密钥 → 密文串（AES-256-GCM，带版本前缀，便于将来换算法）。 */
function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}`;
}

/** 密文串 → 明文密钥；密钥不对或数据被改过时抛错（GCM 的认证标签会拦住）。 */
function decryptSecret(payload, key) {
  const text = String(payload === undefined || payload === null ? '' : payload);
  if (!text.startsWith(ENCRYPTION_PREFIX)) {
    throw new Error('验证器密钥格式不认识（可能是更早的版本或换过加密方式）');
  }
  const [iv, data, tag] = text.slice(ENCRYPTION_PREFIX.length).split(':');
  if (!iv || !data || !tag) {
    throw new Error('验证器密钥内容不完整');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ── 备用码 ───────────────────────────────────────────────────────

/** 生成一批备用码（明文，只在生成的那一次响应里出现）。 */
function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = [];
  for (let index = 0; index < count; index += 1) {
    let raw = '';
    for (let char = 0; char < BACKUP_CODE_CHARS; char += 1) {
      raw += BACKUP_ALPHABET[crypto.randomInt(0, BACKUP_ALPHABET.length)];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** 归一化：大小写与横线都不影响匹配（用户抄错一个横线不该算错）。 */
function normalizeBackupCode(code) {
  return String(code === undefined || code === null ? '' : code).toUpperCase().replace(/[\s-]/g, '');
}

/**
 * 备用码是不是这个形状：用来和 6 位验证码区分开，走不同的校验分支。
 *
 * 两种写法都认：`XXXXX-XXXXX`，以及**丢掉了横线的 10 位连续字符** ——
 * 手抄备用码时最容易漏的就是那个横线，为此把人挡在门外不值得。
 * 6 位验证码是 6 个字符，长度对不上，所以不会误判。
 */
function isBackupCodeShape(code) {
  const text = String(code === undefined || code === null ? '' : code).trim().toUpperCase();
  if (BACKUP_CODE_PATTERN.test(text)) {
    return true;
  }
  return /^[0-9A-Z]{10}$/.test(text.replace(/[\s-]/g, ''));
}

/**
 * 备用码的存储哈希。
 *
 * 用 sha256 而不是 bcrypt：备用码是 10 位随机串（约 50 bit 熵），
 * 不是人选的口令，离线爆破的成本足够高，而这里每次登录都要算一次，慢哈希不划算。
 */
function hashBackupCode(code) {
  return crypto.createHash('sha256').update(`calmobile-backup:${normalizeBackupCode(code)}`).digest('hex');
}

module.exports = {
  BASE32_ALPHABET,
  BACKUP_ALPHABET,
  BACKUP_CODE_PATTERN,
  BACKUP_CODE_COUNT,
  DEFAULT_STEP_SEC,
  DEFAULT_DIGITS,
  DEFAULT_WINDOW,
  base32Encode,
  base32Decode,
  hotp,
  generateSecret,
  codeFor,
  verifyCode,
  otpauthUri,
  encryptionKey,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  normalizeBackupCode,
  isBackupCodeShape,
  hashBackupCode,
  sameText,
};
