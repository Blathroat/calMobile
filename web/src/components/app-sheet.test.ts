/**
 * 底部面板的 `dismissible`：不可关闭的提示（用户协议更新）不能被点遮罩或 Escape 关掉，
 * 普通面板保持原来的行为。其余交互（按钮动作、焦点）不在这里重复覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import AppSheet from './AppSheet.vue';
import { closeSheet, openSheet, sheet } from '@/services/sheet';

let app: App | undefined;

beforeEach(async () => {
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  // 退场动画立即结束，测试不用等 220ms。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(async () => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  vi.unstubAllGlobals();
});

async function mountSheet(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(AppSheet);
  app.mount(container);
  await nextTick();
  return container;
}

function overlay(): HTMLElement {
  return document.querySelector<HTMLElement>('.sheet')!;
}

function clickOverlay(): void {
  overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('底部面板的关闭方式', () => {
  it('dismissible: false 时点遮罩与 Escape 都不关', async () => {
    openSheet({
      title: '用户协议更新',
      message: '请确认最新版本',
      dismissible: false,
      actions: [{ label: '同意', variant: 'primary', onClick: (close) => close() }],
    });
    await mountSheet();
    clickOverlay();
    await nextTick();
    expect(sheet.current?.closing).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(sheet.current?.closing).toBe(false);
    // 按钮仍然能主动关闭，不可关闭只是关掉了遮罩与 Escape 两条路。
    [...document.querySelectorAll<HTMLButtonElement>('.sheet .cta')][0]!.click();
    await vi.waitFor(() => expect(sheet.current).toBeNull());
  });

  it('普通面板点遮罩仍然关闭', async () => {
    openSheet({ title: '普通面板', message: '可关闭' });
    await mountSheet();
    clickOverlay();
    await nextTick();
    expect(sheet.current?.closing).toBe(true);
    await vi.waitFor(() => expect(sheet.current).toBeNull());
  });
});
