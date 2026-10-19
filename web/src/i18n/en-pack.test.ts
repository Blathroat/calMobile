import { describe, expect, it } from 'vitest';
import { PACK_BYTES, packBytes, parsePack } from './packs';
import packJson from '../../public/lang/en.json';
import builtinNested from './zh.json';

/**
 * 随包发布的英文语言包（`web/public/lang/en.json`，部署后是 `/lang/en.json`）。
 *
 * 它是要装到用户机器上的东西，所以在这里挡住三类会静默降级的漂移：
 * 结构/体积被运行时拒收、键对不上（缺的回退中文、多的永远不会被读到）、
 * 占位名字对不上（屏幕上会留下 `{name}` 这种字面量）。
 * 加了新的界面文案后要同步更新这个包，否则这里会红。
 */

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

describe('英文语言包', () => {
  const pack = parsePack(packJson);

  it('能过运行时校验，且没超体积上限', () => {
    expect(pack.id).toBe('en');
    expect(pack.name).toBe('English');
    expect(packBytes(pack)).toBeLessThanOrEqual(PACK_BYTES);
  });

  it('没有中文表里不存在的键', () => {
    expect(Object.keys(pack.strings).filter((key) => !(key in builtin))).toEqual([]);
  });

  it('覆盖全部键，占位名字与中文一致', () => {
    expect(Object.keys(builtin).filter((key) => !(key in pack.strings))).toEqual([]);
    expect(
      Object.keys(pack.strings).filter(
        (key) => key in builtin && placeholders(builtin[key]!) !== placeholders(pack.strings[key]!),
      ),
    ).toEqual([]);
  });
});
