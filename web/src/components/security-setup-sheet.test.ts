/**
 * 身份复核抽屉：验证码没发出去之前不能写「验证码已发送到」，发成功后才显示收件地址。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import SecuritySetupSheet from './SecuritySetupSheet.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function mountSheet(sendIdentityCode: () => Promise<string>): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(SecuritySetupSheet, {
    kind: 'identity-only',
    action: 'disable',
    identityScope: 'factor',
    totpAvailable: false,
    maskedEmail: 'us***@example.com',
    sendIdentityCode,
    verifyIdentity: vi.fn(),
    submitAction: vi.fn(),
  });
  app.mount(container);
  return container;
}

function sendButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('发送验证码'));
  expect(button).not.toBeUndefined();
  return button!;
}

describe('身份复核的验证码提示', () => {
  it('发送前不写「验证码已发送到」', () => {
    const container = mountSheet(async () => 'us***@example.com');
    expect(container.textContent).toContain('发送验证码');
    expect(container.textContent).not.toContain('验证码已发送到');
  });

  it('发送成功后才显示收件地址', async () => {
    const container = mountSheet(async () => 'us***@example.com');
    sendButton(container).click();
    await vi.waitFor(() => expect(container.textContent).toContain('验证码已发送到 us***@example.com'));
  });

  it('发送失败时仍不显示「验证码已发送到」', async () => {
    const container = mountSheet(async () => {
      throw new Error('发送失败');
    });
    sendButton(container).click();
    await vi.waitFor(() => expect(container.textContent).toContain('发送失败'));
    expect(container.textContent).not.toContain('验证码已发送到');
  });
});
