/**
 * 把进程环境一次性解析成配置对象。
 *
 * 纯函数：`parseEnv(env, argv)` 只看传入的对象，不读、不改 `process.env`。
 * 启动入口把 `process.env` 与 `process.argv` 喂进来一次，其余模块从返回值取值。
 *
 * 密钥校验（非空、≥32 字符、禁占位符）与 `config/auth.ts` 相同：缺 key 在解析时就失败。
 */

import { resolveRuntime, type Runtime } from './runtime.js';
import { resolveAuthConfig } from './auth.js';
import { resolveDatabaseConfig, type DatabaseConfig } from './database.js';
import { resolveMailConfig, type MailConfig } from './mail.js';

export type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface ProcessSettings {
  port: number;
  logLevel: string;
  corsOrigin: string;
}

/**
 * 通行密钥（WebAuthn）的依赖方配置。
 *
 * 密码 + 通行密钥两步验证里，浏览器在注册 / 断言时会把 rpId 与 origin 一起签进响应；
 * 服务端必须拿同一组值去校验，否则合法凭据会被判成伪造。
 */
export interface WebAuthnConfig {
  /** RP ID：域名或 IP，不带协议与端口。 */
  rpId: string;
  /** 显示名；空串表示用服务器设置里的中文标题（读不到用 CalMobile）。 */
  rpName: string;
  /** 允许的完整来源（origin），校验注册 / 登录响应时使用。 */
  origins: string[];
}

export interface ProcessConfig {
  env: EnvLike;
  runtime: Runtime;
  auth: ReturnType<typeof resolveAuthConfig>;
  mail: MailConfig;
  database: DatabaseConfig;
  totpSecretKey: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  webauthn: WebAuthnConfig;
}

/**
 * @param env
 */
export function resolveProcessSettings(env: EnvLike = {}): ProcessSettings {
  return {
    port: Number(env.PORT) || 3000,
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigin: env.CORS_ORIGIN || '*',
  };
}

/**
 * @param env 形如 `process.env`。
 * @param argv 形如 `process.argv`（含 node 与脚本路径，函数自己 slice）。
 */
export function parseEnv(env: EnvLike = {}, argv: string[] = []): ProcessConfig {
  const runtime = resolveRuntime(argv, env);
  const resolvedAuth = resolveAuthConfig(env);
  const settings = resolveProcessSettings(env);
  return {
    env,
    runtime,
    auth: resolvedAuth,
    mail: resolveMailConfig(env),
    database: resolveDatabaseConfig(env),
    totpSecretKey: resolvedAuth.totpSecretKey,
    port: settings.port,
    logLevel: settings.logLevel,
    corsOrigin: settings.corsOrigin,
    webauthn: resolveWebAuthnConfig(env, { publicBaseUrl: runtime.publicBaseUrl, port: settings.port }),
  };
}

/** 合法的 RP ID：只允许域名 / IP 字符，写错时退回默认值而不是让整站起不来。 */
const RP_ID_PATTERN = /^[A-Za-z0-9.-]+$/;

/**
 * App 内的 WebAuthn 来源：`android:apk-key-hash:<签名证书 SHA-256 的 base64url>`。
 * 它不是 http(s) 地址，走 `new URL()` 会被当成别的协议丢掉，所以要单独认出来。
 */
const APK_KEY_HASH_ORIGIN = /^android:apk-key-hash:[A-Za-z0-9_-]{43}$/;

/** 把逗号分隔的 WEBAUTHN_ORIGINS 解析成去重后的 origin 列表；写错的条目直接丢掉。 */
function declaredOrigins(value: unknown): string[] {
  const origins: string[] = [];
  for (const item of String(value ?? '').split(',')) {
    const text = item.trim();
    if (!text) continue;
    const origin = APK_KEY_HASH_ORIGIN.test(text) ? text : httpOrigin(text);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** http(s) 来源统一成 `协议://主机[:端口]`：去掉尾斜杠与路径；写错的返回空串。 */
function httpOrigin(value: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return '';
    return url.origin;
  } catch {
    // 不是绝对地址：丢掉这一条，其余照常生效。
    return '';
  }
}

/**
 * 解析通行密钥的 RP 配置（纯函数，用例直接喂环境对象）。
 *
 * - RP ID：默认取 PUBLIC_BASE_URL 的主机名；没配对外地址时用 localhost。
 * - 来源：默认是 PUBLIC_BASE_URL 的 origin 加本机 http 两个端口（应用内 WebView 调试、
 *   系统浏览器直开报名站各用一个来源）；配了 WEBAUTHN_ORIGINS 就只用配置的那组。
 *   App 内使用通行密钥时要额外列出 `android:apk-key-hash:<证书哈希>` 这一种来源。
 * - 显示名：默认留空，由路由读服务器设置里的中文标题，读不到再用 CalMobile。
 */
export function resolveWebAuthnConfig(
  env: EnvLike = {},
  options: { publicBaseUrl?: string; port?: number } = {},
): WebAuthnConfig {
  const port = options.port ?? 3000;
  let rpId = 'localhost';
  let publicOrigin = '';
  const baseUrl = String(options.publicBaseUrl ?? '').trim();
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      rpId = url.hostname || 'localhost';
      publicOrigin = url.origin;
    } catch {
      // 非法地址当没配：默认的 localhost 仍然能用于本机调试。
    }
  }
  const override = String(env.WEBAUTHN_RP_ID ?? '').trim();
  if (override && RP_ID_PATTERN.test(override)) {
    rpId = override;
  }
  const defaults = [...(publicOrigin ? [publicOrigin] : []), `http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const configured = declaredOrigins(env.WEBAUTHN_ORIGINS);
  return {
    rpId,
    rpName: String(env.WEBAUTHN_RP_NAME ?? '').trim(),
    origins: configured.length > 0 ? configured : [...new Set(defaults)],
  };
}

let processConfig: ProcessConfig | undefined;

/** 进程启动时解析一次；单测请调用 `parseEnv` 并自己注入环境。 */
export function loadProcessConfig(): ProcessConfig {
  if (!processConfig) {
    processConfig = parseEnv(process.env, process.argv);
  }
  return processConfig;
}
