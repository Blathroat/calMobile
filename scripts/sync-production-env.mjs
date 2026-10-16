/**
 * 把仓库和 GitHub 上的新配置补进服务器环境文件。
 *
 * 只补还没有的键。服务器上已有的非空值保持不动，文件里多出来的键也保留。
 * 空字符串不算提供了值，不会覆盖，也不会写成空键。
 * 必填密钥在服务器和传入值里都没有时，返回错误，不产出文件内容。
 *
 * 纯函数不读磁盘。命令行 `--apply` 只从进程环境读取 `SERVER_VALUE_KEYS`，
 * 避免把 PATH 或其他密钥写进服务器。新增一个键时，这里和
 * `.github/workflows/release.yml` 的部署环境要一起改。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnvFile } from './client-target.mjs';

/** 两边都没有就拒绝部署的密钥。用户名和邮箱一并放在 GitHub Secrets。 */
export const REQUIRED_SERVER_SECRETS = [
  'JWT_SECRET',
  'TOTP_SECRET_KEY',
  'DB_PASSWORD',
  'MAIL_SMTP_PASSWORD',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'ADMIN_EMAIL',
];

/**
 * 允许从 GitHub 补进服务器的键。固定非密钥项在 `deploy/production.env`，不在这张表里。
 * 构建用的 `ANDROID_*` 不进服务器。
 */
export const SERVER_VALUE_KEYS = [
  ...REQUIRED_SERVER_SECRETS,
  'APP_API_BASE',
  'PUBLIC_BASE_URL',
  'PRIVACY_POLICY_URL',
  'LANG_PACK_DEFAULT',
  'LANG_PACK_URLS',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_SSL',
  'MAIL_SMTP_HOST',
  'MAIL_SMTP_PORT',
  'MAIL_SMTP_SECURE',
  'MAIL_SMTP_TLS_REJECT_UNAUTHORIZED',
  'MAIL_SMTP_USER',
  'MAIL_FROM_ADDRESS',
  'MAIL_REPLY_TO',
  'FORCE_HTTPS',
  'HSTS_MAX_AGE',
  'UPLOAD_DIR',
  'MEDIA_BASE_URL',
  'UPLOAD_MAX_MB',
  'JWT_EXPIRES_IN',
  'REFRESH_TOKEN_TTL',
];

/** @param {string} value */
export function formatEnvValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
function assignments(text) {
  return new Map(Object.entries(parseEnvFile(text)));
}

/**
 * @param {{
 *   currentText: string,
 *   templateText: string,
 *   incoming?: Record<string, string | undefined>,
 *   requiredSecrets?: string[],
 * }} input
 * @returns {{ ok: true, text: string, added: string[] } | { ok: false, missing: string[] }}
 */
export function syncProductionEnv(input) {
  const currentText = String(input.currentText ?? '');
  const current = assignments(currentText);
  const template = assignments(input.templateText ?? '');
  /** @type {Record<string, string>} */
  const provided = {};
  for (const [key, value] of Object.entries(input.incoming ?? {})) {
    if (typeof value === 'string' && value !== '') provided[key] = value;
  }
  const required = input.requiredSecrets ?? REQUIRED_SERVER_SECRETS;
  const missing = required.filter((key) => {
    const existing = current.get(key);
    return (existing === undefined || existing === '') && provided[key] === undefined;
  });
  if (missing.length > 0) return { ok: false, missing };

  /** @type {Map<string, string>} */
  const desired = new Map(template);
  for (const [key, value] of Object.entries(provided)) desired.set(key, value);

  /** @type {string[]} */
  const added = [];
  for (const [key, value] of desired) {
    const existing = current.get(key);
    if (existing !== undefined && existing !== '') continue;
    if (value === '') continue;
    added.push(key);
  }
  if (added.length === 0) {
    const text = currentText.length === 0 ? '' : currentText.endsWith('\n') ? currentText : `${currentText}\n`;
    return { ok: true, text, added };
  }

  const pending = new Set(added);
  const normalized = currentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.length ? normalized.split('\n') : [];
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const rewritten = lines.map((line) => {
    const matched = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!matched) return line;
    const key = matched[1] ?? '';
    if (!pending.has(key)) return line;
    pending.delete(key);
    return `${key}=${formatEnvValue(desired.get(key) ?? '')}`;
  });
  for (const key of added) {
    if (!pending.has(key)) continue;
    rewritten.push(`${key}=${formatEnvValue(desired.get(key) ?? '')}`);
  }
  return { ok: true, text: `${rewritten.join('\n')}\n`, added };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function incomingFromEnv(env) {
  /** @type {Record<string, string>} */
  const incoming = {};
  for (const key of SERVER_VALUE_KEYS) {
    const value = env[key];
    if (typeof value === 'string') incoming[key] = value;
  }
  return incoming;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return '';
  return args[index + 1];
}

function applyFromArgs(args) {
  const currentPath = readFlag(args, '--current');
  const templatePath = readFlag(args, '--template');
  const outPath = readFlag(args, '--out');
  if (!currentPath || !templatePath || !outPath) {
    process.stderr.write('用法：node scripts/sync-production-env.mjs --current 文件 --template 文件 --out 文件\n');
    process.exit(2);
  }
  const result = syncProductionEnv({
    currentText: readFileSync(currentPath, 'utf8'),
    templateText: readFileSync(templatePath, 'utf8'),
    incoming: incomingFromEnv(process.env),
  });
  if (!result.ok) {
    process.stderr.write(`服务器还没有这些配置，GitHub 也没有提供：${result.missing.join(', ')}\n`);
    process.exit(1);
  }
  writeFileSync(outPath, result.text, { mode: 0o600 });
  process.stdout.write(`补上的键：${result.added.length ? result.added.join(', ') : '无'}\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  applyFromArgs(process.argv.slice(2));
}
