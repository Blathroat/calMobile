import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_BYTES, packBytes, parsePack } from './packs';
import builtinNested from './zh.json';

/**
 * 英文语言包（`lang-packs/en.json`）与中文表的一致性。
 *
 * 这个包**不入库**：它在本机工作区 `lang-packs/`（见那里的 README），是给
 * 「设置 → 语言 → 选择 JSON 文件安装」用的成品，仓库里只有生成与校验工具。
 *
 * 它要装到用户机器上，三类漂移会静默降级，所以本机有这份包时逐条挡住：
 * 结构/体积被运行时拒收、键对不上（缺的回退中文、多的永远不会被读到）、
 * 占位名字对不上（屏幕上会留下 `{name}` 这种字面量）。
 * 改了界面文案后，用这里或 `node lang-packs/pack.mjs check lang-packs/en.json` 复查。
 *
 * 本机没有这个文件时整组跳过（CI 里没有它）。
 */

const PACK_PATH = join(process.cwd(), '..', 'lang-packs', 'en.json');
const available = existsSync(PACK_PATH);
// 在模块层读完：describe.skipIf 只标记跳过，回调体照样执行，别把读文件放进去。
const pack = available ? parsePack(JSON.parse(readFileSync(PACK_PATH, 'utf8'))) : null;

/** 与 `index.ts` / `packs.ts` 一致：嵌套表压成点分路径。 */
function flatten(node: Record<string, unknown>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') flat[path] = value;
    else if (value && typeof value === 'object') Object.assign(flat, flatten(value as Record<string, unknown>, path));
  }
  return flat;
}

function placeholders(text: string): string {
  return [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

const builtin = flatten(builtinNested as Record<string, unknown>);

describe.skipIf(!available)('英文语言包（本机 lang-packs/en.json，不入库）', () => {
  it('能过运行时校验，且没超体积上限', () => {
    expect(packBytes(pack!)).toBeLessThanOrEqual(PACK_BYTES);
  });

  it('没有中文表里不存在的键', () => {
    expect(Object.keys(pack!.strings).filter((key) => !(key in builtin))).toEqual([]);
  });

  it('覆盖全部键，占位名字与中文一致', () => {
    expect(Object.keys(builtin).filter((key) => !(key in pack!.strings))).toEqual([]);
    expect(
      Object.keys(pack!.strings).filter(
        (key) => key in builtin && placeholders(builtin[key]!) !== placeholders(pack!.strings[key]!),
      ),
    ).toEqual([]);
  });
});
