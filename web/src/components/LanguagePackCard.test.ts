import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia } from 'pinia';
import LanguagePackCard from './LanguagePackCard.vue';
import { resetLangForTests } from '@/i18n';
import { flushDeferredToast, toasts } from '@/services/toast';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountCard(host: HTMLElement): void {
  app = createApp(LanguagePackCard).use(createPinia());
  app.mount(host);
}

function toastTexts(): string[] {
  return toasts.map((item) => item.text);
}

/** 走一遍「从文件安装」：语言包安装成功后组件会整页重载，这里只看落盘结果。 */
async function installFile(host: HTMLElement): Promise<void> {
  // 包文件里的 strings 是嵌套 JSON（与 zh.json 同形）。
  const file = new File(
    [JSON.stringify({ id: 'en', name: 'English', strings: { auth: { login: { title: 'Log in' } } } })],
    'en.json',
    { type: 'application/json' },
  );
  const input = host.querySelector<HTMLInputElement>('#settings-lang-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input!.dispatchEvent(new Event('change'));
}

/** URL 字段（含它的错误行）。 */
function urlField(host: HTMLElement): Element | null {
  return host.querySelector('#settings-lang-url')?.closest('.field') ?? null;
}

/** 链接下载的错误文案：只认 URL 字段里的那一行。 */
function urlAlert(host: HTMLElement): string {
  return urlField(host)?.querySelector('[role="alert"]')?.textContent ?? '';
}

/** 文件安装的错误文案：只认紧跟在 #settings-lang-file 后面的那一行。 */
function fileAlert(host: HTMLElement): string {
  const next = host.querySelector('#settings-lang-file')?.nextElementSibling;
  return next?.getAttribute('role') === 'alert' ? (next.textContent ?? '') : '';
}

describe('语言设置', () => {
  it('坏链接显示在这一节，不重新加载', async () => {
    localStorage.clear();
    resetLangForTests();
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    const input = host.querySelector<HTMLInputElement>('#settings-lang-url');
    expect(input).toBeTruthy();
    input!.value = 'notaurl';
    input!.dispatchEvent(new Event('input'));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(urlAlert(host)).toContain('请填写');
    });
    // 链接错误就标在链接字段上
    expect(urlField(host)?.getAttribute('data-invalid')).toBe('true');
    expect(host.textContent).toContain('语言');
    expect(host.textContent).toContain('中文');
  });

  it('可以改用中文、从文件安装，再删掉', async () => {
    localStorage.clear();
    resetLangForTests();
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    const chinese = [...host.querySelectorAll('button')].find((button) => button.textContent === '中文');
    chinese?.click();
    expect(localStorage.getItem('calmobile.lang.choice')).toBe('zh');

    await installFile(host);
    await vi.waitFor(() => expect(localStorage.getItem('calmobile.lang.packs')).toContain('English'));
    expect(localStorage.getItem('calmobile.lang.choice')).toBe('en');

    app?.unmount();
    resetLangForTests();
    host.replaceChildren();
    mountCard(host);
    const remove = [...host.querySelectorAll('button')].find((button) => button.textContent === '删除');
    remove?.click();
    expect(localStorage.getItem('calmobile.lang.packs')).toBe('[]');
  });

  it('安装成功的提示排在重载之后，重载后只弹一次', async () => {
    resetLangForTests();
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    await installFile(host);
    await vi.waitFor(() => expect(localStorage.getItem('calmobile.lang.packs')).toContain('English'));

    // 安装后整页重载，当场弹的气泡会被冲掉，所以这一刻还没弹出来。
    expect(toastTexts()).not.toContain('语言包已安装');
    expect(sessionStorage.getItem('calmobile.toast.pending')).toContain('语言包已安装');

    flushDeferredToast();
    expect(toastTexts()).toContain('语言包已安装');
    // 取到就删：再 flush 一次也不会重复弹。
    flushDeferredToast();
    expect(toastTexts().filter((text) => text === '语言包已安装')).toHaveLength(1);
    expect(sessionStorage.getItem('calmobile.toast.pending')).toBeNull();
  });

  it('有原生桥时用原生读文件安装：取消静默，真失败留在卡片里', async () => {
    resetLangForTests();
    let mode: 'ok' | 'cancelled' | 'failed' = 'ok';
    const invoke = vi.fn((_action: string, _payload: string, callbackId: string) => {
      if (mode === 'ok')
        window.CalMobileBridge?.onResult(
          callbackId,
          true,
          { text: JSON.stringify({ id: 'en', name: 'English', strings: { auth: { login: { title: 'Log in' } } } }) },
          null,
          null,
        );
      else if (mode === 'cancelled') window.CalMobileBridge?.onResult(callbackId, false, null, '用户取消', 'cancelled');
      else window.CalMobileBridge?.onResult(callbackId, false, null, '读不到文件', null);
    });
    vi.stubGlobal('CalMobileNative', { invoke });
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    // 有桥时不渲染文件选择器的 label，改由按钮直接触发原生读取。
    expect(host.querySelector('label[for="settings-lang-file"]')).toBeNull();
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '从文件安装');
    // 安装期间按钮禁用（busy），DOM 更新在下一个微任务，点下一次之前先等它放开。
    const waitIdle = () => vi.waitFor(() => expect((button as HTMLButtonElement | undefined)?.disabled).toBe(false));

    button?.click();
    await vi.waitFor(() => expect(localStorage.getItem('calmobile.lang.packs')).toContain('English'));
    expect(invoke).toHaveBeenLastCalledWith('media.importText', expect.any(String), expect.any(String));

    await waitIdle();
    mode = 'cancelled';
    button?.click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await waitIdle();
    mode = 'failed';
    button?.click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(fileAlert(host)).toContain('无法使用'));
    // 文件安装的失败不占链接字段、也不把链接输入框标红
    expect(urlField(host)?.getAttribute('data-invalid')).toBe('false');
    expect(urlAlert(host)).toBe('');
  });

  it('链接错误与文件安装错误各显示在自己的位置', async () => {
    resetLangForTests();
    const invoke = vi.fn((_action: string, _payload: string, callbackId: string) =>
      window.CalMobileBridge?.onResult(callbackId, false, null, '读不到文件', null),
    );
    vi.stubGlobal('CalMobileNative', { invoke });
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    // 链接下载失败：错误在 URL 字段里，输入框标红。
    const input = host.querySelector<HTMLInputElement>('#settings-lang-url');
    input!.value = 'notaurl';
    input!.dispatchEvent(new Event('input'));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(urlAlert(host)).toContain('请填写'));
    expect(urlField(host)?.getAttribute('data-invalid')).toBe('true');

    // 文件安装失败：错误跟在文件入口下面，链接字段与它自己的错误都不受影响。
    const fileButton = [...host.querySelectorAll('button')].find((item) => item.textContent === '从文件安装');
    fileButton?.click();
    await vi.waitFor(() => expect(fileAlert(host)).toContain('无法使用'));
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(urlField(host)?.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(urlAlert(host)).toContain('请填写');
    expect(urlField(host)?.getAttribute('data-invalid')).toBe('true');
  });

  it('浏览器里下载中文底稿，成功给出提示', async () => {
    resetLangForTests();
    const createObjectURL = vi.fn(() => 'blob:zh-template');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '下载中文底稿');
    button?.click();
    await vi.waitFor(() => expect(toastTexts()).toContain('中文底稿已保存'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('有原生桥时走系统另存为：取消静默，真失败才报失败', async () => {
    resetLangForTests();
    let mode: 'ok' | 'cancelled' | 'failed' = 'ok';
    const invoke = vi.fn((_action: string, _payload: string, callbackId: string) => {
      if (mode === 'ok') window.CalMobileBridge?.onResult(callbackId, true, { exported: true }, null, null);
      else if (mode === 'cancelled') window.CalMobileBridge?.onResult(callbackId, false, null, '用户取消', 'cancelled');
      else window.CalMobileBridge?.onResult(callbackId, false, null, '没写成功', null);
    });
    vi.stubGlobal('CalMobileNative', { invoke });
    const host = document.createElement('div');
    document.body.append(host);
    mountCard(host);

    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '下载中文底稿');
    button?.click();
    await vi.waitFor(() => expect(toastTexts()).toContain('中文底稿已保存'));
    expect(invoke).toHaveBeenLastCalledWith('export.text', expect.any(String), expect.any(String));

    mode = 'cancelled';
    button?.click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(toastTexts()).not.toContain('底稿保存失败');

    mode = 'failed';
    button?.click();
    await vi.waitFor(() => expect(toastTexts()).toContain('底稿保存失败'));
  });
});
