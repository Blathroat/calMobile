import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { api, bootApp } from '@/app/runtime';
import { confirmSheet } from '@/services/sheet';
import SecurityPage from './SecurityPage.vue';

vi.mock('@/app/runtime', () => ({
  bootApp: vi.fn().mockResolvedValue(undefined),
  api: {
    security: {
      get: vi.fn(),
      enableTwoFactor: vi.fn(),
      verifyTwoFactor: vi.fn(),
      disableTwoFactor: vi.fn(),
    },
  },
}));
vi.mock('@/services/sheet', () => ({ confirmSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

let app: App | undefined;
const securityInfo = (enabled = false) => ({
  email: 'user@example.com', emailVerified: true, canEnable: true, twoFactorEnabled: enabled,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

function toggle(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#security-2fa')!;
}

async function clickButton(label: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  button!.click();
  await flush();
}

async function fill(selector: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

async function mount(enabled = false): Promise<void> {
  vi.mocked(api.security.get).mockResolvedValue(securityInfo(enabled));
  document.body.innerHTML = '<div id="security-test"></div>';
  app = createApp(SecurityPage);
  app.use(createPinia()).mount('#security-test');
  await flush();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bootApp).mockResolvedValue(undefined);
  window.CalMobileStrings = {
    s_1589w37: '取消',
    s_16xoiwx: '使用邮箱',
    s_1jjtbcm: '验证并开启',
    s_1b3874r: '关闭两步验证',
  };
  vi.mocked(api.security.enableTwoFactor).mockResolvedValue({ ok: true });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  delete window.CalMobileStrings;
});

describe('两步验证开关以服务器已确认状态为准', () => {
  it('打开方式面板与取消后都保持未开启', async () => {
    await mount();
    toggle().click();
    expect(toggle().checked).toBe(false);
    await flush();
    await clickButton('取消');
    expect(toggle().checked).toBe(false);
    expect(api.security.enableTwoFactor).not.toHaveBeenCalled();
  });

  it('发码失败后保持未开启，并展示错误', async () => {
    vi.mocked(api.security.enableTwoFactor).mockRejectedValue(new Error('发码失败'));
    await mount();
    toggle().click();
    await flush();
    await clickButton('使用邮箱');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('发码失败');
    expect(toggle().checked).toBe(false);
  });

  it('发码和验证期间保持未开启，服务器确认成功后才开启', async () => {
    const verified = deferred<{ ok: boolean }>();
    vi.mocked(api.security.verifyTwoFactor).mockReturnValue(verified.promise);
    await mount();
    toggle().click();
    await flush();
    await clickButton('使用邮箱');
    expect(toggle().checked).toBe(false);
    await fill('#security-2fa-code', '123456');
    await clickButton('验证并开启');
    expect(api.security.verifyTwoFactor).toHaveBeenCalledWith('123456');
    expect(toggle().checked).toBe(false);
    vi.mocked(api.security.get).mockResolvedValue(securityInfo(true));
    verified.resolve({ ok: true });
    await flush();
    expect(toggle().checked).toBe(true);
  });

  it('关闭确认、输入密码和服务器处理期间保持开启，成功后才关闭', async () => {
    const disabled = deferred<{ ok: boolean }>();
    vi.mocked(api.security.disableTwoFactor).mockReturnValue(disabled.promise);
    await mount(true);
    toggle().click();
    expect(toggle().checked).toBe(true);
    await flush();
    const confirmations = vi.mocked(confirmSheet).mock.calls;
    const confirmation = confirmations[confirmations.length - 1]![0];
    await confirmation.onConfirm?.();
    await flush();
    expect(toggle().checked).toBe(true);
    await fill('#security-2fa-password', 'current-password');
    await clickButton('关闭两步验证');
    expect(api.security.disableTwoFactor).toHaveBeenCalledWith('current-password');
    expect(toggle().checked).toBe(true);
    vi.mocked(api.security.get).mockResolvedValue(securityInfo(false));
    disabled.resolve({ ok: true });
    await flush();
    expect(toggle().checked).toBe(false);
  });
});
