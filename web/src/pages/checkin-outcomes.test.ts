/**
 * 核销结果常驻列表的回归。
 *
 * 页面原来只有一张结果卡：核销一个人就把上一个人顶掉，刷新后什么都不剩，
 * 收集项还被压成一段文字。这里锁住改造后的行为：
 *
 * - 核销成功后结果卡出现，并按当前用户分键写进本机存储；
 * - 重新挂载页面后记录仍在；
 * - 多行 answers 按收集项逐行渲染，不再塞进一个 span；
 * - 核销时间按后端下发的 YYYY-MM-DD HH24:MI:SS 显示到秒；
 * - 顶栏清理图标一次清空列表与本机存储，并提示已清理；
 * - 「继续核销」只清当前状态，不动历史。
 *
 * 触发识别走「选择图像扫码」：与 checkin-pick-image.test.ts 同一套桩，
 * 摄像头取景那条链路不在本文件覆盖范围内。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import CheckinPage from './CheckinPage.vue';
import { useSessionStore } from '@/stores/session';
import { createQrDecoder, type QrDecoder } from '@/services/qr-decoder';
import { api } from '@/app/runtime';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({ api: { checkIn: vi.fn() } }));
vi.mock('@/services/qr-decoder', () => ({ createQrDecoder: vi.fn() }));
vi.mock('@/services/device-services', () => ({
  device: { ensureCameraPermission: vi.fn().mockResolvedValue(true), pickImage: vi.fn() },
}));
vi.mock('@/composables/useHint', () => ({ useHint: () => ({ dismiss: vi.fn() }) }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));
// 本文件不碰手动输入面板，也不进底部面板。
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));

const CODE = 'CALMOBILE-CHECKIN|exh-1|reg-1';
const KEY = 'calmobile.checkin.outcomes.exhibitor-1';
const ANSWERS = '姓名 / 公司名称：张三\n参观身份：专业观众';
const CHECKED_AT = '2026-10-17 16:22:20';

const RECORD = {
  recordId: 'reg-1',
  exhibitionId: 'exh-1',
  exhibitionTitle: '秋季展会',
  visitorName: '张三',
  registrationTime: '10-01 09:00',
  answers: ANSWERS,
  checkInTime: CHECKED_AT,
};

let app: App | undefined;
let decoder: QrDecoder;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  decoder = { ready: Promise.resolve(), decode: vi.fn().mockResolvedValue(CODE), dispose: vi.fn() };
  vi.mocked(createQrDecoder).mockReturnValue(decoder);
  vi.mocked(api.checkIn).mockResolvedValue({
    ok: true,
    status: '已参加',
    message: '已核销 张三 的报名',
    record: RECORD,
  });
  // 选图解码链路：内核解出图 -> canvas 取像素 -> 解码器，全部走桩。
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(16), width: 800, height: 600 }),
  } as unknown as CanvasRenderingContext2D);
  document.body.innerHTML = '<div id="app-top-actions"></div><div id="checkin-test"></div>';
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 挂一次核销页；顶栏操作的目标元素与页面同一次渲染里创建。 */
async function mountPage(userId = 'exhibitor-1'): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: userId, role: 'exhibitor', can: { limited: false } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/checkin', component: CheckinPage }],
  });
  await router.push('/checkin');
  app = createApp(CheckinPage).use(pinia).use(router);
  app.mount('#checkin-test');
  await nextTick();
}

/** 走「选择图像扫码」触发一次核销：识别 -> api.checkIn -> 结果入列表。 */
async function checkInOnce(): Promise<void> {
  document.querySelector<HTMLButtonElement>('[data-action="pick-image"]')!.click();
  const input = document.querySelector<HTMLInputElement>('[data-action="pick-image-input"]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['x'], 'qr.png', { type: 'image/png' })],
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(api.checkIn).toHaveBeenCalledWith(CODE));
}

function cards(): NodeListOf<Element> {
  return document.querySelectorAll('[data-testid="checkin-outcome"]');
}

function cardText(): string {
  return cards()[0]?.textContent ?? '';
}

describe('核销结果常驻列表', () => {
  it('核销成功后卡片出现，并按当前用户写进本机存储', async () => {
    await mountPage();
    await checkInOnce();

    await vi.waitFor(() => expect(cards().length).toBe(1));
    expect(cardText()).toContain('张三');
    expect(cardText()).toContain('秋季展会');

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].record.checkInTime).toBe(CHECKED_AT);
    expect(stored[0].record.answers).toBe(ANSWERS);
  });

  it('重新挂载页面后记录仍在', async () => {
    await mountPage();
    await checkInOnce();
    await vi.waitFor(() => expect(cards().length).toBe(1));

    app?.unmount();
    app = undefined;
    await mountPage();

    await vi.waitFor(() => expect(cards().length).toBe(1));
    expect(cardText()).toContain('张三');
  });

  it('多行 answers 按收集项逐行渲染，不塞成一段', async () => {
    await mountPage();
    await checkInOnce();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="checkin-answer"]').length).toBe(2));

    const labels = [...document.querySelectorAll('[data-testid="checkin-answer"] .row-meta')].map((node) =>
      node.textContent?.trim(),
    );
    const values = [...document.querySelectorAll('[data-testid="checkin-answer"] .strong')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(['姓名 / 公司名称', '参观身份']);
    expect(values).toEqual(['张三', '专业观众']);
    // 整段原文（含换行）没有作为一段文字塞进卡片
    expect(cardText()).not.toContain(ANSWERS);
  });

  it('核销时间显示到秒', async () => {
    await mountPage();
    await checkInOnce();

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="checkin-time"]')?.textContent).toBe(CHECKED_AT),
    );
  });

  it('点顶栏清理图标后列表与本机存储都清空', async () => {
    await mountPage();
    await checkInOnce();
    await vi.waitFor(() => expect(cards().length).toBe(1));

    const clear = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('#app-top-actions .icon-button');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(clear.getAttribute('aria-label')).toBe('清理记录');

    clear.click();
    await nextTick();

    expect(cards().length).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(toast).toHaveBeenCalledWith('已清理本页的核销记录', 'success');
  });

  it('「继续核销」只清当前状态，历史记录留着', async () => {
    await mountPage();
    await checkInOnce();
    await vi.waitFor(() => expect(cards().length).toBe(1));

    document.querySelector<HTMLButtonElement>('[data-action="continue"]')!.click();
    await nextTick();

    expect(cards().length).toBe(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('本机存储里的坏数据逐条跳过，不丢整份', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        null,
        'junk',
        { record: '不是对象' },
        { id: 'no-record' },
        { id: 'ok', ok: true, record: RECORD },
      ]),
    );
    await mountPage();
    await nextTick();

    expect(cards().length).toBe(1);
    expect(cardText()).toContain('张三');
  });

  it('按账号分键：别的账号的记录不会显示', async () => {
    localStorage.setItem(
      'calmobile.checkin.outcomes.other-user',
      JSON.stringify([{ id: 'a', ok: true, statusText: '', message: '', record: RECORD }]),
    );
    await mountPage('exhibitor-1');
    await nextTick();

    expect(cards().length).toBe(0);
  });
});
