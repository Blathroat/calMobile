import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 兼容字段守卫。
 *
 * 接口里的 `status` / `statusLabel` / `modeLabel` / `roleLabel` 是**服务端下发的旧中文标签**，
 * 只留给「还没更新快照的旧页面」：它们会随语言环境变化而失效（装了语言包后回传的是译文、
 * 比较也比不中），所以新代码一律读 `statusCode` / `role`，显示交给
 * `services/status.ts` 的 label 函数。
 *
 * 这条测试把「新代码不要读它们」变成可执行的约束：谁在读，这里就红。
 * 等旧快照不再需要兼容时，把服务端那几个字段和这条测试一起删掉。
 */

// vitest 的 cwd 是 web/，直接按包目录取 src。
const SRC = join(process.cwd(), 'src');
const COMPAT_FIELD = /\.(statusLabel|modeLabel|roleLabel)\b/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
      continue;
    }
    if (!/\.(ts|vue)$/.test(entry) || entry.endsWith('.test.ts')) continue;
    out.push(path);
  }
  return out;
}

describe('兼容字段', () => {
  it('生产代码不读旧的中文标签字段', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => COMPAT_FIELD.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
