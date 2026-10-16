import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia } from 'pinia';
import LanguagePackCard from './LanguagePackCard.vue';
import { resetLangForTests } from '@/i18n';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  document.body.replaceChildren();
  localStorage.clear();
});

describe('语言设置', () => {
  it('坏链接显示在这一节，不重新加载', async () => {
    localStorage.clear();
    resetLangForTests();
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(LanguagePackCard).use(createPinia());
    app.mount(host);

    const input = host.querySelector<HTMLInputElement>('#settings-lang-url');
    expect(input).toBeTruthy();
    input!.value = 'notaurl';
    input!.dispatchEvent(new Event('input'));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('请填写');
    });
    expect(host.textContent).toContain('语言');
    expect(host.textContent).toContain('中文');
  });

  it('可以改用中文、从文件安装，再删掉', async () => {
    localStorage.clear();
    resetLangForTests();
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(LanguagePackCard).use(createPinia());
    app.mount(host);

    const chinese = [...host.querySelectorAll('button')].find((button) => button.textContent === '中文');
    chinese?.click();
    expect(localStorage.getItem('calmobile.lang.choice')).toBe('zh');

    const file = new File(
      [JSON.stringify({ id: 'en', name: 'English', strings: { 'auth.login.title': 'Log in' } })],
      'en.json',
      { type: 'application/json' },
    );
    const input = host.querySelector<HTMLInputElement>('#settings-lang-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(localStorage.getItem('calmobile.lang.packs')).toContain('English'));
    expect(localStorage.getItem('calmobile.lang.choice')).toBe('en');

    app.unmount();
    resetLangForTests();
    host.replaceChildren();
    app = createApp(LanguagePackCard).use(createPinia());
    app.mount(host);
    const remove = [...host.querySelectorAll('button')].find((button) => button.textContent === '删除');
    remove?.click();
    expect(localStorage.getItem('calmobile.lang.packs')).toBe('[]');
  });
});
