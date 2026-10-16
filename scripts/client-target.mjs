/**
 * 应用包的构建目标。Gradle、Vite 和 `pnpm dev` 都读这一份。
 *
 * 用纯 JavaScript：Android CI 在跑 Gradle 之前不安装 server 依赖，这里不能靠 tsx。
 * 进程里已经设好的非空变量优先于 `server/.env`，和后端 dotenv 的规则一致。
 * 正式包地址的拒绝规则要与 `server/src/config/production.ts` 的警告保持一致。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = resolve(ROOT, 'server', '.env');
const DEFAULT_APPLICATION_ID = 'com.blathroat.calmobile';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** @param {string} text */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || /^\s*#/.test(line)) continue;
    const matched = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!matched) continue;
    const key = matched[1] ?? '';
    let value = matched[2] ?? '';
    if (value.startsWith('"')) {
      const end = value.endsWith('"') ? value.length - 1 : value.length;
      value = value.slice(1, end).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {Record<string, string | undefined>} [processEnv]
 * @param {string} [fileText] 单测传入时不再读磁盘。
 */
export function loadBuildEnv(processEnv = process.env, fileText) {
  const fromFile =
    fileText !== undefined
      ? parseEnvFile(fileText)
      : existsSync(ENV_PATH)
        ? parseEnvFile(readFileSync(ENV_PATH, 'utf8'))
        : {};
  const merged = { ...fromFile };
  for (const [key, value] of Object.entries(processEnv)) {
    if (typeof value === 'string' && value !== '') merged[key] = value;
  }
  return merged;
}

/** @param {Record<string, string | undefined>} env */
function listenPort(env) {
  const port = Number(env.PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000;
}

/** @param {string} value */
function assertApiBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`APP_API_BASE 不是合法的绝对地址：${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`APP_API_BASE 只接受 http 或 https：${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`APP_API_BASE 不能带用户信息、查询或片段：${value}`);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/api/v1') {
    throw new Error(`APP_API_BASE 的路径必须是 /api/v1：${value}`);
  }
  return url;
}

/** @param {Record<string, string | undefined>} env */
function applicationIdOf(env) {
  const value = String(env.ANDROID_APPLICATION_ID ?? '').trim();
  if (!value) return DEFAULT_APPLICATION_ID;
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value)) {
    throw new Error(`ANDROID_APPLICATION_ID 不是合法的应用包名：${value}`);
  }
  return value;
}

/** @param {Record<string, string | undefined>} env */
function versionCodeOf(env) {
  const raw = String(env.ANDROID_VERSION_CODE ?? '').trim();
  if (!raw) return 1;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`ANDROID_VERSION_CODE 必须是正整数：${raw}`);
  }
  const code = Number(raw);
  if (code > 2_000_000_000) {
    throw new Error(`ANDROID_VERSION_CODE 超过 2000000000：${raw}`);
  }
  return code;
}

/** @param {Record<string, string | undefined>} env */
function versionNameOf(env) {
  const value = String(env.ANDROID_VERSION_NAME ?? '').trim();
  if (!value) return '0.1.0';
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(value)) {
    throw new Error(`ANDROID_VERSION_NAME 含有不能用在版本名里的字符：${value}`);
  }
  return value;
}

/** @param {Record<string, string | undefined>} env */
export function resolveClientTarget(env) {
  const configured = String(env.APP_API_BASE ?? '').trim();
  const apiBase = configured || `http://127.0.0.1:${listenPort(env)}/api/v1`;
  const url = assertApiBase(apiBase);
  const loopback = LOOPBACK.has(url.hostname);
  return {
    apiBase: `${url.origin}/api/v1`,
    mediaOrigin: url.origin,
    allowCleartext: url.protocol === 'http:',
    loopbackPort: loopback ? Number(url.port || (url.protocol === 'https:' ? 443 : 80)) : null,
    applicationId: applicationIdOf(env),
    versionCode: versionCodeOf(env),
    versionName: versionNameOf(env),
    signing: {
      storeFile: String(env.ANDROID_KEYSTORE_PATH ?? '').trim(),
      storePassword: String(env.ANDROID_KEYSTORE_PASSWORD ?? ''),
      keyAlias: String(env.ANDROID_KEY_ALIAS ?? '').trim(),
      keyPassword: String(env.ANDROID_KEY_PASSWORD ?? ''),
    },
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    process.stdout.write(`${JSON.stringify(resolveClientTarget(loadBuildEnv()))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
