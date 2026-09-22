/**
 * `isEntry()` 的单元测试。
 *
 * 这是 ESM 时代取代 `require.main === module` 的那一次判断，判错的后果很具体：
 * 判成 true 会让「被 import」变成「启动服务」，判成 false 会让 `pnpm dev` / `pnpm start`
 * 起来一个什么都不监听的空进程。所以这条纯函数单独有用例钉住，而不是只靠契约测试。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isEntry } from './entry.js';

/** 造一个「模块文件」的路径与对应 URL：argv 是路径、import.meta.url 是 URL，两边都真实。 */
function moduleAt(name: string): { url: string; scriptPath: string } {
  const scriptPath = path.join(process.cwd(), 'src', name);
  return { url: pathToFileURL(scriptPath).href, scriptPath };
}

test('argv[1] 就是本模块时为真', () => {
  const { url, scriptPath } = moduleAt('index.ts');
  assert.equal(isEntry(url, ['node', scriptPath]), true);
});

test('直接执行编译产物（dist）时路径也对得上', () => {
  const { url, scriptPath } = moduleAt('index.js');
  assert.equal(isEntry(url, ['node', scriptPath]), true);
});

test('argv[1] 是别的文件时为假', () => {
  const index = moduleAt('index.ts');
  const other = moduleAt('config/migrate.ts');
  assert.equal(isEntry(index.url, ['node', other.scriptPath]), false);
});

test('argv 里没有脚本路径时为假', () => {
  const { url } = moduleAt('index.ts');
  assert.equal(isEntry(url, ['node']), false);
  assert.equal(isEntry(url, []), false);
});

test('入参默认取 process.argv，被别的模块静态 import 时为假', () => {
  const { url } = moduleAt('index.ts');
  // 本用例自己就是被 vitest 拉起来的，argv[1] 指向 vitest 的 worker，不是被测模块。
  assert.equal(isEntry(url), false);
});
