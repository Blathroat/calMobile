/**
 * 契约测试用的库名。
 *
 * 基准库名来自 `TEST_DB_NAME`（默认 `calmobile_test`）。vitest 的 globalSetup
 * （`test/global-setup-contract.ts`）用基准名建一个 `_template` 库并迁移 + seed 一次；
 * 每个测试文件从模板克隆一份**自己的**库（库名带文件名），因此文件之间不共享数据，
 * 也就能并行跑。
 */

const DEFAULT_BASE = 'calmobile_test';

/** 基准库名：模板名与各文件的库名都由它派生。 */
export function contractBaseName(): string {
  return process.env.TEST_DB_NAME || DEFAULT_BASE;
}

/** 模板库名。 */
export function contractTemplateName(): string {
  return `${contractBaseName()}_template`;
}

/**
 * 某个测试文件自己的库名。
 *
 * 取文件名（去掉 `.test.ts`）转成下划线形式。PostgreSQL 标识符上限 63 字符，
 * 超长时截断并补一段短哈希，避免两个文件撞名。
 */
export function contractDatabaseFor(testPath: string | undefined): string {
  const stem = (testPath ?? 'unknown').split(/[\\/]/).pop()?.replace(/\.test\.ts$/, '') ?? 'unknown';
  const slug =
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown';
  const name = `${contractBaseName()}_${slug}`;
  if (name.length <= 63) return name;
  let hash = 0;
  for (const ch of stem) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${name.slice(0, 56)}_${hash.toString(36)}`.slice(0, 63);
}
