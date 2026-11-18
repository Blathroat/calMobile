import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyOfferedLang,
  chineseTemplate,
  currentPackVersion,
  downloadMissingPacks,
  installPackFromText,
  resetLangForTests,
  t,
  type TParams,
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

  /** 装一个只有这几条的语言包并选中：断言占位替换时不受中文表措辞影响。 */
  function usePack(paths: Record<string, string>): void {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: nested(paths) }]),
    );
    localStorage.setItem('calmobile.lang.choice', 'en');
    resetLangForTests();
  }

  it('读内置中文，没有这条时才用调用方的回退', () => {
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
    expect(t('missing', undefined, '默认文案')).toBe('默认文案');
    expect(t('missing')).toBe('missing');
  });

  it('第二个参数按名字替换 {占位}，数字也受理，同名的占位都换', () => {
    usePack({ 'demo.line': '{seconds} 秒后可重发，共 {seconds} 秒' });
    expect(t('demo.line', { seconds: 30 })).toBe('30 秒后可重发，共 30 秒');
    usePack({ 'demo.line': '{who} 的邀请码' });
    expect(t('demo.line', { who: '小林' })).toBe('小林 的邀请码');
  });

  it('参数里没有的名字原样留着，多给的参数与原样的值不报错', () => {
    usePack({ 'demo.line': '{a} 与 {b}' });
    expect(t('demo.line', { a: '甲', c: '丙' })).toBe('甲 与 {b}');
    // 运行时值不受类型约束：不是字符串或数字就按「没给」处理，屏幕上看得见。
    expect(t('demo.line', { a: true } as unknown as TParams)).toBe('{a} 与 {b}');
  });

  it('回退文案里的占位同样替换', () => {
    expect(t('missing', { seconds: 3 }, '{seconds} 秒后重试')).toBe('3 秒后重试');
  });

  it('明确给了空串就换成空串；不传第二个参数时占位原样返回', () => {
    usePack({ 'demo.line': '{who} 邀请了你' });
    expect(t('demo.line', { who: '' })).toBe(' 邀请了你');
    expect(t('demo.line')).toBe('{who} 邀请了你');
  });

  it('只认字母数字下划线拼的名字，别的大括号原样留着', () => {
    usePack({ 'demo.line': '{a-b} 与 {} 都不是占位' });
    expect(t('demo.line', { 'a-b': 'x' })).toBe('{a-b} 与 {} 都不是占位');
  });

  it('内置中文的整句占位也走同一条路', () => {
    const source = String(builtin['auth.login.secondsUntilResend']);
    expect(source).toContain('{seconds}');
    expect(t('auth.login.secondsUntilResend', { seconds: 30 })).toBe(source.replace('{seconds}', '30'));
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

  it('跟随服务器默认语言时，按包内版本号覆盖已安装的默认包', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', version: 1, strings: nested({ 'auth.login.title': '旧' }) }]),
    );
    resetLangForTests();
    applyOfferedLang('en');
    expect(t('auth.login.title')).toBe('旧');
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'en',
            name: 'English',
            version: 2,
            strings: nested({ 'auth.login.title': '新' }),
          }),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    applyOfferedLang('en');
    await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(t('auth.login.title')).toBe('新');
    expect(currentPackVersion()).toBe(2);
    // 覆盖后要落盘：下次启动比较的是新版本号，不会重复下载。
    const stored = JSON.parse(localStorage.getItem('calmobile.lang.packs') ?? '[]') as { version?: number }[];
    expect(stored[0]?.version).toBe(2);
    vi.unstubAllGlobals();
  });

  it('服务器上的版本不比本机新时，保留本机那份', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', version: 3, strings: nested({ 'auth.login.title': '本机' }) }]),
    );
    resetLangForTests();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'en',
            name: 'English',
            version: 3,
            strings: nested({ 'auth.login.title': '服务器' }),
          }),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    applyOfferedLang('en');
    await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(t('auth.login.title')).toBe('本机');
    expect(currentPackVersion()).toBe(3);
    vi.unstubAllGlobals();
  });

  it('用户明确选了别的语言时，不检查服务器默认包的新版本', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', version: 1, strings: nested({ 'auth.login.title': '旧' }) }]),
    );
    localStorage.setItem('calmobile.lang.choice', 'zh');
    resetLangForTests();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    applyOfferedLang('en');
    await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
    vi.unstubAllGlobals();
  });

  it('检查新版本失败时不提示，本机那份继续用', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', version: 1, strings: nested({ 'auth.login.title': '旧' }) }]),
    );
    resetLangForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 500 })),
    );
    applyOfferedLang('en');
    const errors = await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(errors).toEqual([]);
    expect(t('auth.login.title')).toBe('旧');
    vi.unstubAllGlobals();
  });

  it('没装过的默认包照旧安装', async () => {
    resetLangForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'en',
              name: 'English',
              version: 4,
              strings: nested({ 'auth.login.title': 'Log in' }),
            }),
          ),
      ),
    );
    applyOfferedLang('en');
    await downloadMissingPacks([{ id: 'en', url: 'https://example.com/en.json' }]);
    expect(t('auth.login.title')).toBe('Log in');
    expect(currentPackVersion()).toBe(4);
    vi.unstubAllGlobals();
  });

  it('中文底稿是一份可直接安装的嵌套语言包', () => {
    const pack = JSON.parse(chineseTemplate()) as {
      id?: unknown;
      name?: unknown;
      version?: unknown;
      strings?: Record<string, unknown>;
    };
    expect(pack.id).toBe('en');
    expect(pack.name).toBe('English');
    // 发布新一版时把版本号改大，跟随服务器默认语言的客户端才会换成新包。
    expect(pack.version).toBe(1);
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
