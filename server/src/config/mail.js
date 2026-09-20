/**
 * 邮件通道配置。
 *
 * 三种通道（`MAIL_TRANSPORT`）：
 * - `console`：把邮件全文（含验证码）打进服务端日志，**本地开发默认**，不碰网络，
 *   不开容器也能把注册全流程走完；
 * - `smtp`：真发信。开发指向 Mailpit（`pwsh -File scripts\mail.ps1 start`，
 *   SMTP 1025 / 收件箱 8025），生产指向阿里云邮件推送 / 腾讯云 SES / Resend 之类的
 *   SMTP 中继 —— 应用服务器**不自建 SMTP**（25 端口被封、没有 IP 信誉，验证码会进垃圾箱）；
 * - `memory`：仅测试用，邮件留在内存里给用例取（`services/mailer.js` 的 `outbox()`）。
 *   生产环境下即使显式配置也会被拒并降级为 `smtp` —— 否则线上会「发信成功」，
 *   而用户永远收不到验证码，这种故障最难查。
 *
 * **配置缺失不抛异常**：后端连数据库连不上都照常启动（见 index.js），邮件配错更不该拦启动。
 * 缺什么记在 `problems` 里，由 `/status` 的「邮件通道」自检项显示；发信时再明确报错，
 * 结果落进 `mail_log`（见 `services/otp.js`）。
 */

/** 可用通道。顺序即文档顺序，改动要同步 README 与 .env.example。 */
const TRANSPORTS = ['console', 'smtp', 'memory'];

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SEND_TIMEOUT_MS = 8000;

/** 布尔环境变量：只认 true / 1 / yes / on（大小写无关）。 */
function bool(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value === undefined || value === null ? '' : value).trim().toLowerCase());
}

/** 解析端口等正整数；非法值退回 fallback（不抛异常，问题由 problems 说话）。 */
function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value === undefined || value === null ? '' : value).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

/**
 * 解析一份配置。抽成纯函数，用例可以直接喂各种环境组合，不必改 `process.env` 再重新 require。
 *
 * @param {object} env 形如 `process.env` 的对象。
 */
function resolveMailConfig(env = {}) {
  const nodeEnv = String(env.NODE_ENV || 'development');
  const isProduction = nodeEnv === 'production';
  const requested = String(env.MAIL_TRANSPORT || '').trim().toLowerCase();
  const problems = [];

  if (requested && !TRANSPORTS.includes(requested)) {
    problems.push(`MAIL_TRANSPORT=${requested} 不是可用通道（可选：${TRANSPORTS.join(' / ')}）`);
  }

  // 生产默认 smtp：忘了配也要在状态页上直说「缺 MAIL_SMTP_HOST」，
  // 而不是安静地走 console —— 那等于验证码只写在服务器日志里，用户永远卡在注册页。
  let transport = TRANSPORTS.includes(requested) ? requested : (isProduction ? 'smtp' : 'console');
  if (transport === 'memory' && isProduction) {
    problems.push('生产环境不能用 memory 通道（邮件只留在内存里，用户收不到）');
    transport = 'smtp';
  }

  const port = positiveInt(env.MAIL_SMTP_PORT, DEFAULT_SMTP_PORT);
  // 465 是隐式 TLS；其余交给 STARTTLS。显式给了 MAIL_SMTP_SECURE 就听它的。
  const secure = env.MAIL_SMTP_SECURE === undefined ? port === 465 : bool(env.MAIL_SMTP_SECURE);

  const smtp = {
    host: String(env.MAIL_SMTP_HOST || '').trim(),
    port,
    secure,
    user: String(env.MAIL_SMTP_USER || ''),
    pass: String(env.MAIL_SMTP_PASSWORD || ''),
    // 默认校验证书；只有自签名的内网中继才该显式关掉。
    rejectUnauthorized: env.MAIL_SMTP_TLS_REJECT_UNAUTHORIZED === undefined
      ? true
      : bool(env.MAIL_SMTP_TLS_REJECT_UNAUTHORIZED),
  };

  // 开发默认一个带点的假地址（Mailpit 什么都收）；生产必须显式配，否则报缺失。
  const fromAddress = String(env.MAIL_FROM_ADDRESS || '').trim()
    || (isProduction ? '' : 'no-reply@calmobile.local');

  if (transport === 'smtp') {
    if (!smtp.host) {
      problems.push('SMTP 通道缺少 MAIL_SMTP_HOST');
    }
    if (!fromAddress) {
      problems.push('SMTP 通道缺少 MAIL_FROM_ADDRESS（发件人地址，收件方会校验）');
    }
    if (smtp.user && !smtp.pass) {
      problems.push('配了 MAIL_SMTP_USER 却没有 MAIL_SMTP_PASSWORD');
    }
  }

  return {
    nodeEnv,
    isProduction,
    transport,
    smtp,
    fromAddress,
    replyTo: String(env.MAIL_REPLY_TO || '').trim(),
    sendTimeoutMs: positiveInt(env.MAIL_SEND_TIMEOUT_MS, DEFAULT_SEND_TIMEOUT_MS),
    problems,
    configured: problems.length === 0,
  };
}

/**
 * 给状态页与日志用的摘要：**不带 SMTP 密码**。
 * 状态页是给人看的排查入口，把凭据放上去等于把密码写进浏览器。
 */
function describeMailConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    transport: config.transport,
    configured: config.configured,
    problems: config.problems,
    smtpHost: config.smtp.host,
    smtpPort: config.smtp.port,
    smtpSecure: config.smtp.secure,
    smtpAuth: Boolean(config.smtp.user),
    fromAddress: config.fromAddress,
    replyTo: config.replyTo,
    sendTimeoutMs: config.sendTimeoutMs,
  };
}

/** 进程启动时解析一次；`resolveMailConfig` 供用例与脚本另算。 */
const mailConfig = resolveMailConfig(process.env);

module.exports = {
  TRANSPORTS,
  DEFAULT_SMTP_PORT,
  DEFAULT_SEND_TIMEOUT_MS,
  mailConfig,
  resolveMailConfig,
  describeMailConfig,
};
