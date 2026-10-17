/**
 * 手动输入报名码的端到端回归。
 *
 * 真因在 services/sheet.ts：导出深只读状态会把 AppSheet 用 v-bind 传下去的面板 props
 * 一起变成只读代理，ManualCodePanel 的 v-model 只留一句控制台告警就静默失败，页面拿到的
 * 永远是空码，提交时报「请输入报名码」。
 *
 * 这里挂真实的 AppSheet 与真实的 sheet 服务（不 mock openSheet），锁住「输入能写回、
 * 核销请求带上完整码」；粘贴面板同一套约定，共用一条等价断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import CheckinPage from './CheckinPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import PasteTextPanel from '@/components/PasteTextPanel.vue';
import { useSessionStore } from '@/stores/session';
import { closeSheet, openSheet, sheet } from '@/services/sheet';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { api } from '@/app/runtime';

vi.mock('@/app/runtime', () => ({ api: { checkIn: vi.fn() } }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { ensureCameraPermission: vi.fn().mockResolvedValue(true) },
}));
vi.mock('@/composables/useHint', () => ({ useHint: () => ({ dismiss: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const CODE = 'CALMOBILE-CHECKIN|秋季展会|报名-1';
let app: App | undefined;
let decoder: QrDecoder;

beforeEach(async () => {
  // 面板状态是模块级的：上一个用例留下的面板要先收干净，否则会盖住新挂载的外壳。
  if (sheet.current) {
    closeSheet();
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  vi.clearAllMocks();
  decoder = { ready: Promise.resolve(), decode: vi.fn().mockResolvedValue(null), dispose: vi.fn() };
  vi.mocked(createQrDecoder).mockReturnValue(decoder);
  vi.mocked(api.checkIn).mockResolvedValue({ ok: true });
  document.body.innerHTML = '<div id="checkin-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

/** 挂核销页 + 真外壳（AppSheet 渲染面板内容与动作按钮）。 */
async function mountCheckin(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { limited: false } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/checkin', component: CheckinPage }],
  });
  await router.push('/checkin');
  app = createApp({ render: () => [h(CheckinPage), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#checkin-test');
  await nextTick();
}

function sheetButton(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('.sheet-panel button')].find(
    (button) => button.textContent?.trim() === label,
  )!;
}

async function typeInto(selector: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

describe('手动输入报名码走面板', () => {
  it('面板输入写回页面数据，核销请求带上完整报名码', async () => {
    await mountCheckin();
    document.querySelector<HTMLButtonElement>('[data-action="manual"]')!.click();
    await nextTick();
    await nextTick();
    expect(document.querySelector('.sheet-panel #checkin-code')).not.toBeNull();

    await typeInto('#checkin-code', CODE);
    sheetButton('核销').click();

    await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith(CODE));
    // 校验通过的提交会收起面板（退场动画结束后才移除），不会停在「请输入报名码」上。
    await vi.waitFor(() => expect(document.querySelector('.sheet-panel #checkin-code')).toBeNull());
  });

  it('空码提交留在面板里就地提示，不发核销请求', async () => {
    await mountCheckin();
    document.querySelector<HTMLButtonElement>('[data-action="manual"]')!.click();
    await nextTick();
    await nextTick();

    sheetButton('核销').click();
    await nextTick();

    expect(api.checkIn).not.toHaveBeenCalled();
    expect(document.querySelector('.sheet-panel .field-error')?.textContent).toContain('请输入报名码');
    expect(document.querySelector('.sheet-panel #checkin-code')).not.toBeNull();
  });

  it('粘贴面板同样能把输入写回调用方的响应式对象', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    app = createApp({ render: () => h(AppSheet) }).use(pinia);
    app.mount('#checkin-test');
    const model = reactive({ text: '' });
    openSheet({ title: '粘贴 Markdown', component: PasteTextPanel, props: { model } });
    await nextTick();
    await nextTick();

    await typeInto('#paste-markdown', '# 标题');
    expect(model.text).toBe('# 标题');
  });
});
