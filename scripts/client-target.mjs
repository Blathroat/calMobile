/**
 * 应用包的构建目标。Gradle、Vite 和 `pnpm dev` 都读这一份。
 *
 * 用纯 JavaScript：Android CI 在跑 Gradle 之前不安装 server 依赖，这里不能靠 tsx。
 * env 文件读取搬到了 `scripts/env-file.mjs`，这里 re-export，既有 import 不用改。
 * 正式包地址的拒绝规则要与 `server/src/config/production.ts` 的警告保持一致。
 */

import { pathToFileURL } from 'node:url';
import { loadBuildEnv, parseEnvFile } from './env-file.mjs';

export { loadBuildEnv, parseEnvFile };

const DEFAULT_APPLICATION_ID = 'com.blathroat.calmobile';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

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

/**
 * 品牌短名：导出文件名与相册目录用它，默认沿用主实例的 calmobile。
 * 只允许字母、数字、下划线、横线：它会被拼进文件名与 directories。
 * @param {Record<string, string | undefined>} env
 */
function brandSlugOf(env) {
  const value = String(env.ANDROID_BRAND_SLUG ?? '').trim();
  if (!value) return 'calmobile';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(value)) {
    throw new Error(`ANDROID_BRAND_SLUG 只允许字母、数字、下划线、横线且不超过 24 位：${value}`);
  }
  return value;
}

/**
 * 桌面显示名：不配时用资源里的 app_name（`@string/app_name`）。
 * 这里只做单行文本校验，避免引号/换行把 AndroidManifest 的占位符弄坏。
 * @param {Record<string, string | undefined>} env
 */
function appLabelOf(env) {
  const value = String(env.ANDROID_APP_LABEL ?? '').trim();
  if (!value) return '@string/app_name';
  if (value.length > 40 || /["\\\r\n]/.test(value)) {
    throw new Error(`ANDROID_APP_LABEL 不能带引号、反斜杠或换行，且不超过 40 个字符：${value}`);
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
    brandSlug: brandSlugOf(env),
    appLabel: appLabelOf(env),
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
