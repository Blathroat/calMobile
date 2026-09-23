/**
 * 邮件发送适配层。
 *
 * 上层（`domain/otp.ts`）只认 `send(message)`，不关心码是怎么出去的：
 * 本地走 `console`（打进日志）或 `smtp`（打进 Mailpit），测试走 `memory`（留在内存里）。
 * 换生产通道（阿里云邮件推送 / 腾讯云 SES / Resend 的 SMTP）只改 `.env`，代码不动。
 *
 * 两个刻意的设计：
 * 1. **不抛异常**：返回 `{ ok, transport, error?, messageId?, ms }`。发信失败是**业务结果**，
 *    调用方要写进 `mail_log` 并决定要不要重试，而不是把异常冒泡成 500 ——
 *    用户看到「验证码已发送」但收不到，和接口直接报 500，是两件需要分别处理的事。
 * 2. **调用方不等发信**：SMTP 往返轻易超过前端 `api.js` 的 `REQUEST_TIMEOUT = 3000`，
 *    所以发码接口一律「先落库、立刻回包、后台发信」（见 `domain/otp.ts`）。
 *
 * `nodemailer` 只是被 import 一次，真正的 SMTP 连接池仍然按需懒建（见 `smtpTransport`）：
 * console / memory 通道与单测都不会碰它。
 */

import nodemailer from 'nodemailer';
import { mailConfig, type MailConfig } from '../config/mail.js';
import { sanitizeHeader } from './mail-templates.js';

/** 与 `routes/auth-hono.ts` 的注册校验、`routes/profile.ts` 的邮箱校验保持一致。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MailMessage {
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  fromName?: unknown;
  purpose?: unknown;
}

export interface BuiltMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export interface StoredMail extends BuiltMessage {
  purpose: string;
  sentAt: string;
}

export interface SendResult {
  ok: boolean;
  transport: string;
  messageId?: string;
  error?: string;
  ms: number;
}

interface SmtpTransport {
  sendMail(message: BuiltMessage): Promise<{ messageId?: string }>;
  close?: () => void;
}

/** `memory` 通道的收件箱。用例靠它拿到验证码，别在业务代码里读它。 */
const inbox: StoredMail[] = [];

/** 复用的 SMTP 连接池；键变了（换配置）就重建。 */
let transporter: SmtpTransport | null = null;
let transporterKey = '';

/** 测试用：清空收件箱并断开连接池。 */
export function resetMailer(): void {
  inbox.length = 0;
  closeTransporter();
}

/** `memory` 通道收到的邮件（按时间先后）。 */
export function outbox(): StoredMail[] {
  return inbox.slice();
}

/** 最近一封 `memory` 通道的邮件；没有就是 null。 */
export function lastMail(): StoredMail | null {
  return inbox.length > 0 ? inbox[inbox.length - 1] || null : null;
}

/** 把配置变成邮件头里的 from：显示名去掉引号与尖括号，再整体加引号。 */
export function formatFrom(name: unknown, address: string): string {
  const safe = sanitizeHeader(name).replace(/["<>]/g, '').trim();
  return safe ? `"${safe}" <${address}>` : address;
}

/**
 * 组装邮件的最终形态（该清洗的都在这里清洗完），memory 通道存的也是它。
 * 收件地址必须是合法邮箱：`to` 里带空白就等于带换行，同样是邮件头注入。
 */
export function buildMessage(message: MailMessage, config: MailConfig): BuiltMessage {
  const to = String(message.to === undefined || message.to === null ? '' : message.to).trim();
  if (!EMAIL_PATTERN.test(to) || to.length > 120) {
    throw new Error('收件地址为空或格式不正确');
  }
  return {
    from: formatFrom(message.fromName, config.fromAddress),
    to,
    replyTo: config.replyTo || undefined,
    subject: sanitizeHeader(message.subject, '（无主题）'),
    text: String(message.text || ''),
    html: String(message.html || ''),
  };
}

/** 错误 → 一行可读的原因（nodemailer 的错误码比 message 更能说明问题）。 */
function describeError(error: unknown): string {
  if (!error) {
    return '未知错误';
  }
  const record = error as { code?: unknown; message?: unknown };
  const code = record.code ? `${record.code}: ` : '';
  return `${code}${record.message || String(error)}`;
}

/** 给一个 promise 套总超时：连接与 socket 超时之外再兜一层。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`发信超时（${ms} ms）`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

/** 延迟创建（并复用）SMTP 连接池；配置变了就重建。走 console / memory 时不会被调用。 */
function smtpTransport(config: MailConfig): SmtpTransport {
  const key = [config.smtp.host, config.smtp.port, config.smtp.secure, config.smtp.user].join('|');
  if (transporter && transporterKey === key) {
    return transporter;
  }
  closeTransporter();
  // 连接池选项本仓库只用得到的这几个；其余按 nodemailer 的默认值。
  const created = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: config.sendTimeoutMs,
    greetingTimeout: config.sendTimeoutMs,
    socketTimeout: config.sendTimeoutMs,
    tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
  }) as SmtpTransport;
  transporter = created;
  transporterKey = key;
  return transporter;
}

/** 断开发信连接池；进程退出与用例清理时调用，没建过就是空操作。 */
export function closeTransporter(): void {
  if (transporter && typeof transporter.close === 'function') {
    transporter.close();
  }
  transporter = null;
  transporterKey = '';
}

/** console 通道的排版：本地不开容器也能把验证码抄下来。 */
function logToConsole(built: BuiltMessage, purpose: unknown): void {
  const line = '─'.repeat(56);
  console.log(
    [
      line,
      `邮件（console 通道，未真正发送${purpose ? `；用途 ${purpose}` : ''}）`,
      `收件人：${built.to}`,
      `主　题：${built.subject}`,
      line,
      built.text,
      line,
    ].join('\n'),
  );
}

/**
 * 发一封邮件。
 *
 * @param message `{ to, subject, text, html, fromName?, purpose? }`。
 * @param options.config 供测试与脚本注入，默认取进程配置。
 */
export async function send(message: MailMessage, options: { config?: MailConfig } = {}): Promise<SendResult> {
  const config = options.config || mailConfig;
  const startedAt = Date.now();
  const ms = () => Date.now() - startedAt;

  if (!config.configured) {
    return {
      ok: false,
      transport: config.transport,
      error: `邮件通道未配置：${config.problems.join('；')}`,
      ms: ms(),
    };
  }

  let built: BuiltMessage;
  try {
    built = buildMessage(message, config);
  } catch (error: unknown) {
    return { ok: false, transport: config.transport, error: describeError(error), ms: ms() };
  }

  try {
    if (config.transport === 'memory') {
      if (config.isProduction) {
        // resolveMailConfig 已经拦下了这种组合；这里再兜一次，防止有人绕过去构造配置。
        throw new Error('生产环境不允许 memory 通道');
      }
      inbox.push({ ...built, purpose: String(message.purpose || ''), sentAt: new Date().toISOString() });
      return { ok: true, transport: 'memory', messageId: `memory-${inbox.length}`, ms: ms() };
    }
    if (config.transport === 'console') {
      logToConsole(built, message.purpose);
      return { ok: true, transport: 'console', messageId: `console-${startedAt}`, ms: ms() };
    }
    const info = await withTimeout(smtpTransport(config).sendMail(built), config.sendTimeoutMs);
    return { ok: true, transport: 'smtp', messageId: (info && info.messageId) || '', ms: ms() };
  } catch (error: unknown) {
    return { ok: false, transport: config.transport, error: describeError(error), ms: ms() };
  }
}
