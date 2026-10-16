import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOfferedLang, downloadMissingPacks, resetLangForTests, t } from './index';
import builtin from './zh.json';

describe('t', () => {
  beforeEach(() => {
    localStorage.clear();
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
          strings: { 'auth.login.title': 'Log in', 'settings.lang.title': '' },
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
      JSON.stringify([{ id: 'en', name: 'English', strings: { 'auth.login.title': 'Log in' } }]),
    );
    localStorage.setItem('calmobile.lang.server', 'en');
    resetLangForTests();
    expect(t('auth.login.title')).toBe('Log in');
    localStorage.setItem('calmobile.lang.choice', 'zh');
    resetLangForTests();
    expect(t('auth.login.title')).toBe(builtin['auth.login.title']);
  });

  it('自动下载跳过已经安装的 id', async () => {
    localStorage.setItem(
      'calmobile.lang.packs',
      JSON.stringify([{ id: 'en', name: 'English', strings: { 'auth.login.title': '旧' } }]),
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
});
