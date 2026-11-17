/**
 * 编辑展会页的日期 / 时间选择与卡片分区（需求 2/3/5/6）。
 *
 * 这里把页面和共享底部面板一起挂到 jsdom 上，走完整的「点字段 → 抽屉 → 选值 → 回填」路径：
 * - 开展 / 闭展是一组日期范围，报名开始 / 截止是另一组，选完两个日期自动收起；
 * - 开展时间点开后是时 / 分滚轮，确认后回填成 HH:MM；
 * - 「展会封面与简介」卡里有简介入口，「报名设置」卡里不再有分隔横线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { navigation } from '@/app/navigation';
import { clearExhibitionDraft } from '@/services/exhibition-draft';
import { formatDateWithWeekday } from '@/services/format';
import { sheet } from '@/services/sheet';
import { api } from '@/app/runtime';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { save: vi.fn(), remove: vi.fn(), get: vi.fn() },
    media: { upload: vi.fn() },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: { importMedia: vi.fn(), discardMedia: vi.fn() },
}));

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearExhibitionDraft();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  navigation.cancel();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 今天之后第 offset 天（`YYYY-MM-DD`），避免用例依赖运行当天的日期。 */
function iso(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 等微任务、重渲染与面板退场动画的 0ms 定时器都跑完。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
}

async function mountForm(): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/exhibition-form', component: ExhibitionFormPage },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/rich-editor', component: { template: '<div />' } },
      { path: '/exhibitor', component: { template: '<div />' } },
    ],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  await router.push('/exhibition-form');
  app = createApp({ render: () => [h(RouterView), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
}

function trigger(id: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`#${id}`);
  if (!element) throw new Error(`缺少触发按钮 #${id}`);
  return element;
}

function dayButton(isoDate: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  if (!button) throw new Error(`抽屉里没有 ${isoDate} 这一天`);
  return button;
}

function sheetAction(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`抽屉里没有「${label}」按钮`);
  return button;
}

describe('编辑展会：日期与时间选择', () => {
  it('开展 / 闭展是一组日期范围，选完两个日期回填并收起抽屉', async () => {
    await mountForm();
    const start = iso(3);
    const end = iso(9);
    trigger('form-date').click();
    await flush();

    expect(document.querySelector('.sheet-title')?.textContent).toBe('选择日期');
    expect(document.querySelector('.date-picker')).not.toBeNull();
    expect(sheetAction('清除')).not.toBeUndefined();

    dayButton(start).click();
    await flush();
    // 只点了起点：抽屉还开着，起点已经回填，小字写「开展」。
    expect(document.querySelector('.date-picker-label')?.textContent).toBe('开展');
    dayButton(end).click();
    await flush();

    expect(sheet.current).toBeNull();
    expect(trigger('form-date').textContent).toContain(formatDateWithWeekday(start));
    expect(trigger('form-end-date').textContent).toContain(formatDateWithWeekday(end));
  });

  it('报名开始 / 截止也是范围选择，两端小字是「开始 / 截止」', async () => {
    await mountForm();
    trigger('form-reg-start').click();
    await flush();
    dayButton(iso(1)).click();
    await flush();
    expect(document.querySelector('.date-picker-label')?.textContent).toBe('开始');
    dayButton(iso(2)).click();
    await flush();
    expect(sheet.current).toBeNull();
    expect(trigger('form-reg-start').textContent).toContain(formatDateWithWeekday(iso(1)));
    expect(trigger('form-reg-end').textContent).toContain(formatDateWithWeekday(iso(2)));
  });

  it('开展时间点开是滚轮，滚到新的小时后确认写回 HH:MM', async () => {
    await mountForm();
    trigger('form-time').click();
    await flush();
    expect(document.querySelector('.sheet-title')?.textContent).toBe('选择时间');

    const hours = document.querySelectorAll<HTMLElement>('.time-wheel-column')[0];
    if (!hours) throw new Error('缺少小时滚轮');
    hours.scrollTop = 10 * 44;
    hours.dispatchEvent(new Event('scroll'));
    await flush();
    sheetAction('确认').click();
    await flush();

    expect(sheet.current).toBeNull();
    expect(trigger('form-time').textContent).toContain('10:00');
  });

  it('「清除」把时间留空，仍符合「时间选填」', async () => {
    await mountForm();
    trigger('form-time-end').click();
    await flush();
    sheetAction('清除').click();
    await flush();
    expect(sheet.current).toBeNull();
    expect(trigger('form-time-end').textContent).toContain('结束时间');
  });
});

describe('编辑展会：卡片分区与文案', () => {
  it('封面卡里能进简介编辑器，报名设置卡不再画分隔线', async () => {
    await mountForm();
    const cards = [...document.querySelectorAll<HTMLElement>('#form-test .card')];
    const cover = cards.find((card) => card.textContent?.includes('展会封面与简介'));
    const registration = cards.find((card) => card.textContent?.includes('报名设置'));
    expect(cover).not.toBeUndefined();
    expect(registration).not.toBeUndefined();
    expect(cover?.textContent).toContain('编辑简介');
    expect(cover?.querySelector('.cover-row')).not.toBeNull();
    // 页面上不再有卡片内分区横线。
    expect(document.querySelectorAll('#form-test hr.divider')).toHaveLength(0);
  });

  it('保存时 payload 带上闭展日期；只选开展就是空串（单日展会）', async () => {
    await mountForm();
    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: { id: 'exh-new' } });
    const fill = (id: string, value: string) => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) throw new Error(`缺少输入框 #${id}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('form-title', '接口测试展');
    fill('form-venue', '测试展馆');

    // 只选开展，用「取消」收起抽屉：闭展保持空串，按单日展会提交。
    const start = iso(3);
    trigger('form-date').click();
    await flush();
    dayButton(start).click();
    await flush();
    sheetAction('取消').click();
    await flush();

    const saveButton = document.querySelector<HTMLButtonElement>('#app-foot button');
    saveButton?.click();
    await vi.waitFor(() => expect(vi.mocked(api.exhibitions.save)).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.date).toBe(start);
    expect(payload.endDate).toBe('');
  });
});
