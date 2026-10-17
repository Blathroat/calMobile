import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyOfferedLang,
  chineseTemplate,
  downloadMissingPacks,
  installPackFromText,
  resetLangForTests,
  t,
} from './index';
import builtinNested from './zh.json';

/** zh.json 是嵌套的；要断言内置表内容时先压平（与 index.ts 的做法一致）。 */
function flatten(node: Record<string, unknown>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') flat[path] = value;
    else if (value && typeof value === 'object') Object.assign(flat, flatten(value as Record<string, unknown>, path));
  }
  return flat;
}

const builtin = flatten(builtinNested as Record<string, unknown>);

/** 语言包文件与 localStorage 里的 strings 都是嵌套的，这里按点分路径拼一棵。 */
function nested(paths: Record<string, string>): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const [path, text] of Object.entries(paths)) {
    const parts = path.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = text;
  }
  return tree;
}

describe('t', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLangForTests();
  });

  it('读内置中文，没有这条时才用调用方的回退', () => {
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
    expect(t('missing', '默认文案')).toBe('默认文案');
    expect(t('missing')).toBe('missing');
  });

  it('别的语言缺一条就回中文，空串不回退', () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([
        {
          id: 'en',
          name: 'English',
          strings: nested({ 'auth.login.title': 'Log in', 'settings.lang.title': '' }),
        },
      ]),
    );
    localStorage.setItem('calmobile.lang.choice', 'en');
    resetLangForTests();
    expect(t('auth.login.title')).toBe('Log in');
    expect(t('settings.lang.title')).toBe('');
    expect(t('settings.lang.chinese')).toBe(builtin['settings.lang.chinese']);
  });

  it('没选过语言时，本机已有服务器默认包就用它', () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: nested({ 'auth.login.title': 'Log in' }) }]),
    );
    localStorage.setItem('calmobile.lang.server', 'en');
    resetLangForTests();
    expect(t('auth.login.title')).toBe('Log in');
    localStorage.setItem('calmobile.lang.choice', 'zh');
    resetLangForTests();
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
  });

  it('本机存着的旧扁平包不兼容，按没有装过处理', () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: { 'auth.login.title': 'Log in' } }]),
    );
    localStorage.setItem('calmobile.lang.choice', 'en');
    resetLangForTests();
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
  });

  it('自动下载跳过已经安装的 id', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: nested({ 'auth.login.title': '旧' }) }]),
    );
    resetLangForTests();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    applyOfferedLang('en', [{ id: 'en', url: 'https://example.com/en.json' }]);
    await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(t('auth.login.title')).toBe('旧');
    vi.unstubAllGlobals();
  });

  it('中文底稿是一份可直接安装的嵌套语言包', () => {
    const pack = JSON.parse(chineseTemplate()) as { id?: unknown; name?: unknown; strings?: Record<string, unknown> };
    expect(pack.id).toBe('en');
    expect(pack.name).toBe('English');
    // 与 zh.json 同形：嵌套，而不是点分扁平键。
    expect(pack.strings).toMatchObject({ auth: { login: { title: builtin['auth.login.title'] } } });
    expect(flatten(pack.strings ?? {})['auth.login.title']).toBe(builtin['auth.login.title']);
  });

  it('安装语言包把成功提示排到重载之后', async () => {
    await installPackFromText(
      JSON.stringify({ id: 'en', name: 'English', strings: nested({ 'auth.login.title': 'Log in' }) }),
    );
    // 当场弹的气泡会被重载冲掉，所以先存起来，重载后由外壳 flush 成 toast。
    expect(sessionStorage.getItem('calmobile.toast.pending')).toContain('语言包已安装');
  });
});
