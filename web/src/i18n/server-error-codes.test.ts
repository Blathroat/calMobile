import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import builtin from './zh.json';

/**
 * 服务端错误码 → 文案表的覆盖守卫。
 *
 * 服务端在失败响应里下发 `errorCode`，前端 `services/http-client.ts` 查 `server.<码>`
 * 把它换成本地化文案；查不到就回退服务端原文（中文）。也就是说**漏了文案不会崩，
 * 只会在英文界面上留一句中文**——所以用这条测试把「服务端新增码必须补文案」变成可执行的约束。
 *
 * 扫描口径：`server/src` 里形如 `x.y` 的字符串字面量，减去下面这张非错误码白名单
 * （进程环境、主题下标、路由名之类的普通标识），其余都当错误码。加了新的普通标识而误报时，
 * 把它加进 ALLOWED 即可。
 */

const SERVER_SRC = join(process.cwd(), '..', 'server', 'src');

/** 不是错误码的 `x.y` 字面量（环境变量、路由名、配置键…）。 */
const ALLOWED = new Set([
  'process.env',
  'process.argv',
  'theme.index',
  'theme.colors',
  'ui.sync',
  'users.list',
  'users.status',
  'user.can',
  'req.ip',
  'err.type',
  'err.status',
  'import.meta.url',
  'params.i18nCode',
  'info.latencyMs',
  'req.originalUrl',
  'upload.avatarSizeMb',
  'c.res.headers',
  'next.media.videoSizeMb',
]);

/** 第三方库（express/body-parser）抛出的错误 type，不是我们的码。 */
const FOREIGN = /^(entity|encoding|request)\.[a-z]/;

/** 文件名（`package.json`、`join.html`…）也不是码。 */
const FILENAME = /\.(json|html|js|ts|md|css|exe|png|jpe?g|webp|mp4|mov)$/;

function flat(node: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, flat(value as Record<string, unknown>, path));
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // 测试设施里的字符串不是产品码。
      if (entry === 'test') continue;
      sourceFiles(path, out);
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(path);
  }
  return out;
}

/** 去掉注释：文档里举的例子不是产品码。行尾 `//` 也去，但避开字符串里的 `https://`。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** `server/src` 里所有看起来像错误码的字面量。 */
function serverCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of sourceFiles(SERVER_SRC)) {
    for (const match of stripComments(readFileSync(file, 'utf8')).matchAll(
      /['"`]([a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*(.[a-zA-Z0-9]+)*)['"`]/g,
    )) {
      const code = match[1]!;
      // 错误码每段都是驼峰；带下划线的是数据库列名（`users.ui_mode` 这类）。
      if (code.includes('_')) continue;
      if (ALLOWED.has(code) || FOREIGN.test(code) || FILENAME.test(code)) continue;
      codes.add(code);
    }
  }
  return codes;
}

const catalog = flat(builtin as Record<string, unknown>);

describe('服务端错误码', () => {
  it('每个码都在文案表里有 server.<码>', () => {
    const missing = [...serverCodes()].filter((code) => !(`server.${code}` in catalog)).sort();
    expect(missing).toEqual([]);
  });
});
