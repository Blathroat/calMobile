/**
 * 生产环境的启动前自检。
 *
 * 分成两档，界限是「配错了会**不安全或根本用不了**」还是「只是不够好」：
 * - `fatal`：拒绝启动。开发密钥、默认库密码、只往日志里打验证码、发件人地址是占位值 ——
 *   这几类要么让任何人都能伪造令牌，要么让注册 / 找回密码 / 两步验证整条链路静默失效；
 * - `warnings`：打在日志里继续启动。同一个进程里看得到的警告比一个不肯起来的服务有用，
 *   而且这些项可能是有意为之（例如内网里就在跑 Mailpit、或反代已经做了来源限制）。
 *
 * 纯函数：用例直接把环境对象喂进来，不需要真的改 `process.env` 再重新 require。
 */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** 一眼能看出是「开发用」的密钥特征。 */
export const DEV_SECRET_HINTS = [
  /local-dev/i,
  /please-change/i,
  /calmobile-local/i,
  /^your_/i,
  /^replace-with/i,
  /^change-me/i,
];

/** 一眼能看出是「占位」的发件人地址。 */
export const PLACEHOLDER_FROM = [/@localhost$/i, /\.local$/i];

export interface ProductionProblems {
  fatal: string[];
  warnings: string[];
}

/**
 * @param env 形如 `process.env`。
 */
export function productionProblems(env: EnvLike = {}): ProductionProblems {
  const fatal: string[] = [];
  const warnings: string[] = [];

  // ── 认证与验证器加密密钥：缺失或弱密钥都不能上线 ───────────────────
  for (const name of ['JWT_SECRET', 'TOTP_SECRET_KEY']) {
    const value = String(env[name] || '');
    if (!value) {
      fatal.push(`${name} 没有配置`);
    } else if (value.length < 32) {
      fatal.push(`${name} 少于 32 个字符`);
    } else if (DEV_SECRET_HINTS.some((pattern) => pattern.test(value))) {
      fatal.push(`${name} 还是开发用的值（含 local-dev / please-change 之类），请换成随机值：openssl rand -hex 32`);
    }
  }

  const dbPassword = String(env.DB_PASSWORD || '');
  if (!dbPassword) {
    fatal.push('DB_PASSWORD 没有配置');
  } else if (dbPassword === 'postgres') {
    fatal.push('DB_PASSWORD 还是 postgres：这是示例密码，换个强密码再上线');
  }

  // ── 会让验证码整条链路静默失效的 ────────────────────────────────
  const transport = String(env.MAIL_TRANSPORT || '')
    .trim()
    .toLowerCase();
  if (transport === 'console') {
    fatal.push('MAIL_TRANSPORT=console：验证码只会写进日志，用户永远收不到（生产请用 smtp）');
  }
  if (transport === 'memory') {
    fatal.push('MAIL_TRANSPORT=memory：这是给测试用的通道，生产禁用');
  }
  const from = String(env.MAIL_FROM_ADDRESS || '').trim();
  if (!from) {
    fatal.push('MAIL_FROM_ADDRESS 没有配置：收件方会校验发件人域，缺了会被拒信');
  } else if (PLACEHOLDER_FROM.some((pattern) => pattern.test(from))) {
    fatal.push(`MAIL_FROM_ADDRESS 是占位地址（${from}）：请换成已配好 SPF/DKIM 的发信域`);
  }

  // ── 可疑但可能是有意为之的 ──────────────────────────────────────
  const smtpHost = String(env.MAIL_SMTP_HOST || '').trim();
  if (/^(127\.0\.0\.1|localhost|::1)$/i.test(smtpHost)) {
    warnings.push(`MAIL_SMTP_HOST=${smtpHost} 看着像本机开发收件箱（Mailpit）。确认生产真的要从这里发信？`);
  }
  if (String(env.MAIL_SMTP_PORT || '') === '1025') {
    warnings.push('MAIL_SMTP_PORT=1025 是 Mailpit 的默认端口，确认生产环境不需要改');
  }

  const cors = String(env.CORS_ORIGIN || '').trim();
  if (!cors || cors === '*') {
    warnings.push('CORS_ORIGIN 是 * 或没配：建议收紧到 WebView 的起源 https://appassets.androidplatform.net');
  }

  // trust proxy 与限流的关系：反代后面不开，按 IP 的限流会变成全体用户共用额度。
  if (!String(env.TRUST_PROXY || '').trim()) {
    warnings.push(
      'TRUST_PROXY 没有配置：如果前面有反向代理，请设为 1（否则 req.ip 是代理地址，按 IP 的验证码限流会退化成全局额度）',
    );
  }

  // 对外地址：报名站域名、分享链接、状态页和邮件里的绝对地址都靠它。
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim();
  if (!publicBaseUrl) {
    warnings.push(
      'PUBLIC_BASE_URL 没有配置：报名站不会绑定域名，分享链接也无法生成。对外部署请填 https://app.example.com',
    );
  } else if (!/^https:\/\//i.test(publicBaseUrl)) {
    warnings.push(`PUBLIC_BASE_URL=${publicBaseUrl} 不是 https：对外地址应当是 https`);
  }
  // HSTS 显式关掉多半是「域名还没定」，但也可能是漏配，提示一句。
  const hsts = String(env.HSTS_MAX_AGE || '')
    .trim()
    .toLowerCase();
  if (['0', 'false', 'off'].includes(hsts)) {
    warnings.push('HSTS_MAX_AGE=0：不下发 Strict-Transport-Security，确认这是有意的');
  }

  if (String(env.LOG_LEVEL || '').toLowerCase() === 'debug') {
    warnings.push('LOG_LEVEL=debug 会打印每个请求，生产建议 info 或 quiet');
  }

  if (
    ['true', '1', 'yes', 'on'].includes(
      String(env.ENABLE_STATUS_PAGE || '')
        .trim()
        .toLowerCase(),
    )
  ) {
    warnings.push('ENABLE_STATUS_PAGE 显式打开了状态页：它包含迁移清单、各表行数与接口清单，请确保外部访问不到');
  }

  // 非本机数据库却没开 SSL：托管数据库通常要求 TLS。
  const dbHost = String(env.DB_HOST || '').trim();
  const remoteDb = Boolean(dbHost) && !/^(127\.0\.0\.1|localhost|::1)$/i.test(dbHost);
  if (
    remoteDb &&
    !['true', '1', 'yes', 'on'].includes(
      String(env.DB_SSL || '')
        .trim()
        .toLowerCase(),
    )
  ) {
    warnings.push(`DB_HOST=${dbHost} 是远端地址但 DB_SSL 没开：托管数据库一般要求 TLS，确认一下`);
  }

  return { fatal, warnings };
}
