/**
 * 构建期 env 文件读取：把 `server/.env` 与进程环境合并成一份构建配置。
 *
 * Gradle、Vite、`pnpm dev`、图标脚本和服务端脚本都读同一份构建目标，所以这里
 * 只放 Node 内置模块，不能靠 tsx 或 Vite。进程里已经设好的非空变量优先于
 * `server/.env`，和后端 dotenv 的规则一致。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = resolve(ROOT, 'server', '.env');

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
