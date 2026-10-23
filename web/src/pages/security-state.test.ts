import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { api } from '@/app/runtime';
import AppSheet from '@/components/AppSheet.vue';
import { closeSheet } from '@/services/sheet';
import SecurityPage from './SecurityPage.vue';

vi.mock('@/app/runtime', () => ({
  api: {
    security: {
      get: vi.fn(),
      identityEmailCode: vi.fn(),
      verifyIdentity: vi.fn(),
      enableTwoFactor: vi.fn(),
      verifyTwoFactor: vi.fn(),
      disableTwoFactor: vi.fn(),
      changeEmail: vi.fn(),
      verifyEmail: vi.fn(),
      totpSetup: vi.fn(),
      activateTotp: vi.fn(),
      totpEnable: vi.fn(),
      backupCodes: vi.fn(),
      sessions: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllSessions: vi.fn(),
    },
    profile: { changePassword: vi.fn() },
    session: { clear: vi.fn() },
  },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

let app: App | undefined;
const securityInfo = (
  mode: 'off' | 'email' | 'totp' = 'off',
  totpConfigured = mode === 'totp',
  backupCodesLeft = 0,
) => ({
  email: 'user@example.com',
  emailVerified: true,
  canEnable: true,
  twoFactorEnabled: mode !== 'off',
  twoFactorMethod: mode,
  totpEnabled: totpConfigured,
  backupCodesLeft,
});

const TestRoot = defineComponent({
  setup: () => () => h('div', [h(SecurityPage), h(AppSheet)]),
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await nextTick();
}

function choice(mode: 'off' | 'email' | 'totp'): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.seg button[data-value="${mode}"]`)!;
}

function selected(mode: 'off' | 'email' | 'totp'): boolean {
  return choice(mode).getAttribute('aria-pressed') === 'true';
}

async function mount(
  mode: 'off' | 'email' | 'totp' = 'off',
  totpConfigured = mode === 'totp',
  backupCodesLeft = 0,
): Promise<void> {
  vi.mocked(api.security.get).mockResolvedValue(securityInfo(mode, totpConfigured, backupCodesLeft));
  document.body.innerHTML = '<div id="security-test"></div>';
  app = createApp(TestRoot);
  app.use(createPinia()).mount('#security-test');
  await flush();
}

async function clickPrimary(): Promise<void> {
  document.querySelector<HTMLButtonElement>('.sheet-panel .cta:not(.ghost)')?.click();
  await flush();
}

async function enterCode(selector: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.value = '123456';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.security.identityEmailCode).mockResolvedValue({ ok: true, maskedEmail: 'u***@example.com' });
  vi.mocked(api.security.verifyIdentity).mockResolvedValue({ ok: true, stepUpToken: 'step-up' });
  vi.mocked(api.security.enableTwoFactor).mockResolvedValue({ ok: true, maskedEmail: 'u***@example.com' });
  vi.mocked(api.security.totpSetup).mockResolvedValue({
    ok: true,
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/test',
    stepUpToken: 'confirm-step',
  });
});

afterEach(async () => {
  app?.unmount();
  app = undefined;
  closeSheet();
  await new Promise((resolve) => setTimeout(resolve, 240));
  document.body.innerHTML = '';
});

describe('安全方式切换与抽屉', () => {
  it('选择邮箱方式打开抽屉，取消后回到关闭选项', async () => {
    await mount();
    choice('email').click();
    await flush();
    document.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
    await flush();
    await enterCode('#security-identity-code');
    await clickPrimary();
    await flush();
    expect(document.querySelector('.sheet-panel #security-sheet-factor-code')).not.toBeNull();
    expect(selected('email')).toBe(true);
    document.querySelector<HTMLButtonElement>('.sheet-panel .ghost')?.click();
    await new Promise((resolve) => setTimeout(resolve, 240));
    await nextTick();
    expect(selected('off')).toBe(true);
    expect(api.security.enableTwoFactor).toHaveBeenCalledTimes(1);
  });

  it('启用请求失败时不改变原选项，并在页面显示原因', async () => {
    vi.mocked(api.security.enableTwoFactor).mockRejectedValue(new Error('发码失败'));
    await mount();
    choice('email').click();
    await flush();
    document.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
    await flush();
    await enterCode('#security-identity-code');
    await clickPrimary();
    await flush();
    expect(selected('off')).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('发码失败');
    expect(document.querySelector('.sheet-panel')).not.toBeNull();
  });

  it('初次绑定先做邮箱身份复核，TOTP 验证失败时滑回原方式', async () => {
    vi.mocked(api.security.totpEnable).mockResolvedValue({ ok: false, error: '验证码不正确' });
    await mount();
    choice('totp').click();
    await flush();
    expect(document.querySelectorAll('.sheet-panel .seg button')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
    await flush();
    expect(api.security.identityEmailCode).toHaveBeenCalledTimes(1);
    await enterCode('#security-identity-code');
    await clickPrimary();
    await flush();
    await enterCode('#security-sheet-totp-code');
    await clickPrimary();
    expect(document.querySelector('.sheet-panel [role="alert"]')?.textContent).toBe('验证码不正确');
    expect(selected('off')).toBe(true);
    expect(api.security.verifyIdentity).toHaveBeenCalledWith('email', '123456', 'totp');
    expect(api.security.totpSetup).toHaveBeenCalledWith('step-up');
    expect(api.security.totpEnable).toHaveBeenCalledWith('123456', 'confirm-step');
  });

  it('已配置 TOTP 后身份复核可选验证器或邮箱', async () => {
    await mount('totp');
    document.querySelector<HTMLButtonElement>('.seg button[data-value="email"]')?.click();
    await flush();
    expect(document.querySelectorAll('.sheet-panel .seg button')).toHaveLength(2);
    expect(document.querySelector('.sheet-panel .seg')?.textContent).toContain('TOTP（推荐）');
    expect(document.querySelector('.sheet-panel .seg')?.textContent).toContain('邮箱验证码');
  });

  it('邮箱验证通过并经安全状态确认后才切换选项', async () => {
    vi.mocked(api.security.verifyTwoFactor).mockResolvedValue({ ok: true, backupCodes: [] });
    vi.mocked(api.security.get).mockResolvedValueOnce(securityInfo('off')).mockResolvedValueOnce(securityInfo('email'));
    await mount();
    choice('email').click();
    await flush();
    document.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
    await flush();
    await enterCode('#security-identity-code');
    await clickPrimary();
    await flush();
    await enterCode('#security-sheet-factor-code');
    await clickPrimary();
    await flush();
    expect(api.security.verifyTwoFactor).toHaveBeenCalledWith('123456');
    expect(selected('email')).toBe(true);
    expect(selected('off')).toBe(false);
  });

  it('已配置 TOTP 后重新开启是一键操作，不再生成新密钥', async () => {
    vi.mocked(api.security.activateTotp).mockResolvedValue({ ok: true });
    await mount('off', true);
    vi.mocked(api.security.get).mockResolvedValueOnce(securityInfo('totp', true));
    choice('totp').click();
    await flush();
    expect(api.security.activateTotp).toHaveBeenCalledTimes(1);
    expect(api.security.totpSetup).not.toHaveBeenCalled();
    expect(selected('totp')).toBe(true);
  });

  it('身份复核失败时立即回滚分段控件', async () => {
    vi.mocked(api.security.verifyIdentity).mockResolvedValue({ ok: false, error: '验证码不正确' });
    await mount();
    choice('totp').click();
    await flush();
    document.querySelector<HTMLButtonElement>('.sheet-panel .cta.ghost')?.click();
    await flush();
    await enterCode('#security-identity-code');
    await clickPrimary();
    expect(selected('off')).toBe(true);
    expect(document.querySelector('.sheet-panel [role="alert"]')?.textContent).toBe('验证码不正确');
  });
});

describe('备用码余量提示', () => {
  it('一枚备用码都没有时给出警告，并把动作改成「生成备用码」', async () => {
    await mount('email', false, 0);
    const warn = document.querySelector('.security-factor .notice[data-tone="warn"]');
    expect(warn?.textContent).toContain('还没有备用码');
    expect(document.querySelector('.security-factor .field-hint')?.textContent).toBe('当前验证方式：用邮箱验证码开启');
    expect(
      Array.from(document.querySelectorAll('.security-factor .text-action')).map((el) => el.textContent?.trim()),
    ).toContain('生成备用码');
  });

  it('只剩两枚以内时提醒重新生成，说明行仍报数量', async () => {
    await mount('email', false, 2);
    const warn = document.querySelector('.security-factor .notice[data-tone="warn"]');
    expect(warn?.textContent).toContain('备用码只剩 2 个');
    expect(document.querySelector('.security-factor .field-hint')?.textContent).toBe(
      '当前验证方式：用邮箱验证码开启；备用码还剩 2 个',
    );
    expect(
      Array.from(document.querySelectorAll('.security-factor .text-action')).map((el) => el.textContent?.trim()),
    ).toContain('重新生成备用码');
  });

  it('余量充足时没有警告', async () => {
    await mount('email', false, 8);
    expect(document.querySelector('.security-factor .notice[data-tone="warn"]')).toBeNull();
    expect(document.querySelector('.security-factor .text-action')?.textContent?.trim()).toBe('重新生成备用码');
  });
});
