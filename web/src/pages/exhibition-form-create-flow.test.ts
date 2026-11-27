/**
 * 新建展会：三步创建流程。
 *
 * 覆盖的规则：
 * - 新建从「基本信息」开始，进度条标出当前步，页脚只有「继续」；
 * - 每一步只校验这一步的字段，校验不过停在那一步、原位标红，不发保存请求；
 * - 「返回」回上一步且保留已填内容，切步骤清掉上一步的错误；
 * - 第三步摊开展会与报名配置，点「发布展会」调用现有创建接口，成功后仍换成编辑地址；
 * - 发布前整表再校一次：出错就退回出错的那一步，红框与说明看得见；
 * - 编辑已有展会不显示三步进度，仍是分组表单与单颗「保存展会」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { clearExhibitionDraft, stashExhibitionDraft } from '@/services/exhibition-draft';
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
  clearExhibitionDraft();
});

/** 等微任务、重渲染与抽屉退场的 0ms 定时器都跑完。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 今天之后第 offset 天（`YYYY-MM-DD`），避免用例依赖运行当天的日期。 */
function iso(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function mountPage(path = '/exhibition-form', prepare?: () => void): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
  useBootstrapStore().apply({ categories: ['智能家居', '物流技术'] });
  prepare?.();
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
  await router.push(path);
  app = createApp({ render: () => [h(RouterView), h(AppSheet)] })
    .use(pinia)
    .use(router);
  app.mount('#form-test');
  await flush();
  return router;
}

/** 编辑已有展会：当前会话是展商本人，详情接口返回同一场展会。 */
function prepareEditExhibition(): void {
  vi.mocked(api.exhibitions.get).mockResolvedValue({
    found: true,
    exhibition: {
      id: 'exh-1',
      exhibitorId: 'exhibitor-1',
      title: '秋季展会',
      venue: '上海新国际博览中心',
      date: '2026-11-20',
      endDate: '2026-11-22',
      statusCode: 'review',
      category: '智能家居',
      description: '服务端简介',
      imageUri: '',
      registrationStart: '',
      registrationEnd: '',
      qrEnabled: false,
      allowCancel: true,
      registrationNotice: '',
    },
    fields: [],
  });
}

async function mountEdit(): Promise<Router> {
  const router = await mountPage('/exhibition-form/exh-1', prepareEditExhibition);
  await vi.waitFor(() => expect(inputValue('form-title')).toBe('秋季展会'));
  return router;
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

/** 往输入框填值并触发 input 事件，模拟用户打字。 */
function fill(id: string, value: string): void {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!input) throw new Error(`缺少输入框 #${id}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function inputValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? '';
}

function clickSheetAction(label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`抽屉里没有「${label}」按钮`);
  button.click();
}

function footerButtons(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].map(
    (item) => item.textContent?.trim() ?? '',
  );
}

async function clickFooter(label: string): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`#app-foot 里缺少「${label}」按钮`);
  button.click();
  await flush();
}

function progressLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.create-progress > span')].map(
    (item) => item.textContent?.trim() ?? '',
  );
}

function currentStep(): string {
  return document.querySelector<HTMLElement>('.create-progress > span[data-current="true"]')?.textContent?.trim() ?? '';
}

/**
 * 字段是否被当前步骤收起：v-show 把 display:none 写在带指令的那一层，
 * 从这里往上找到第一个带内联 display 的祖先即可。
 */
function hiddenByStep(selector: string): boolean {
  let element: HTMLElement | null = document.querySelector(selector);
  while (element && element.style.display === '') element = element.parentElement;
  return element?.style.display === 'none';
}

/** 打开分类抽屉并选中一个分类（分类必填）。 */
async function pickCategory(name = '智能家居'): Promise<void> {
  trigger('form-category').click();
  await flush();
  const option = [...document.querySelectorAll<HTMLButtonElement>('.sheet-option')].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!option) throw new Error(`分类抽屉里没有「${name}」`);
  option.click();
  await flush();
}

/** 第一步必填项：名称、地点、开展日期、分类；给 endOffset 时再选一个闭展日期。 */
async function fillStepOne(options: { endOffset?: number } = {}): Promise<void> {
  fill('form-title', '自动化测试展');
  fill('form-venue', '测试展馆');
  trigger('form-date').click();
  await flush();
  dayButton(iso(3)).click();
  await flush();
  if (options.endOffset === undefined) {
    // 只选开展：闭展留空（单日展会），用「取消」收起抽屉。
    sheetAction('取消').click();
  } else {
    // 再点闭展：两端都回填后抽屉自动收起。
    dayButton(iso(options.endOffset)).click();
  }
  await flush();
  await pickCategory();
}

describe('新建展会：三步创建流程', () => {
  it('从第一步开始：进度条、步骤说明与「继续」都在，第二步内容先收起', async () => {
    await mountPage();

    expect(document.querySelector('.create-progress')?.getAttribute('aria-label')).toBe('第 1 步，共 3 步');
    expect(progressLabels()).toEqual(['基本信息', '报名配置', '发布检查']);
    expect(currentStep()).toBe('基本信息');
    expect(document.querySelector('.create-heading h2')?.textContent).toBe('基本信息');
    expect(document.querySelector('.create-heading .field-hint')?.textContent).toContain('填写展会名称');
    expect(footerButtons()).toEqual(['继续']);

    expect(hiddenByStep('#form-title')).toBe(false);
    expect(hiddenByStep('#form-reg-start')).toBe(true);
    expect(hiddenByStep('#form-description')).toBe(false);
    expect(hiddenByStep('#form-registration-notice')).toBe(false);
  });

  it('第一步校验不过时停在第一步：字段原位标红，不发保存请求', async () => {
    await mountPage();

    await clickFooter('继续');

    expect(currentStep()).toBe('基本信息');
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    // 名称字段没有独立说明行：红框（data-invalid）表示原位报错。
    expect(document.querySelector('#form-title')?.closest('.field')?.getAttribute('data-invalid')).toBe('true');
  });

  it('第一步通过后进入报名配置；第二步校验失败退回时保留已填内容', async () => {
    await mountPage();
    await fillStepOne();

    await clickFooter('继续');
    expect(currentStep()).toBe('报名配置');
    expect(footerButtons()).toEqual(['返回', '继续']);
    expect(hiddenByStep('#form-reg-start')).toBe(false);
    expect(hiddenByStep('#form-title')).toBe(true);

    // 报名开始晚于开展日期：第二步校验不过，停在这一步并标红。
    trigger('form-reg-start').click();
    await flush();
    dayButton(iso(20)).click();
    await flush();
    sheetAction('取消').click();
    await flush();
    await clickFooter('继续');

    expect(currentStep()).toBe('报名配置');
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(trigger('form-reg-start').closest('.field')?.getAttribute('data-invalid')).toBe('true');

    // 返回上一步：错误清掉，第一步的值还在。
    await clickFooter('返回');
    expect(currentStep()).toBe('基本信息');
    expect(inputValue('form-title')).toBe('自动化测试展');
    expect(document.querySelectorAll('.field[data-invalid="true"]')).toHaveLength(0);
  }, 15000);

  it('第二步校验收集项：标题超出上限时停在这一步并提示', async () => {
    await mountPage();
    await fillStepOne();
    await clickFooter('继续');

    const addField = [...document.querySelectorAll<HTMLButtonElement>('#form-test button')].find(
      (item) => item.textContent?.trim() === '新增收集项',
    );
    if (!addField) throw new Error('报名配置里缺少「新增收集项」');
    addField.click();
    await flush();
    const titleInput = document.querySelector<HTMLInputElement>('.collect-item .notch-input');
    if (!titleInput) throw new Error('新增的收集项没有标题输入框');
    // 输入框的 maxlength 挡不住脚本写入，这里直接造一个超长标题。
    titleInput.value = '甲'.repeat(31);
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    await clickFooter('继续');
    expect(currentStep()).toBe('报名配置');
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(document.querySelector('#form-test')?.textContent).toContain('最多 30 个字符');
  });

  it('第三步摊开展会与报名配置；点「发布展会」调用创建接口并换成编辑地址', async () => {
    const router = await mountPage();
    await fillStepOne();
    await clickFooter('继续');
    await clickFooter('继续');

    expect(currentStep()).toBe('发布检查');
    expect(footerButtons()).toEqual(['返回', '发布展会']);
    const review = document.querySelector('.create-review');
    expect(review?.textContent).toContain('发布前核对');
    expect(review?.textContent).toContain('自动化测试展');
    expect(review?.textContent).toContain('测试展馆');
    expect(review?.textContent).toContain('智能家居');
    expect(review?.textContent).toContain('需审核');
    expect(review?.textContent).toContain('0 项');
    // 第三步只留发布检查：基础字段整块不渲染，活动信息 / 报名设置两卡收起。
    expect(document.querySelector('#form-title')).toBeNull();
    expect(document.querySelector('#form-reg-start')).toBeNull();
    expect(hiddenByStep('#form-description')).toBe(true);
    expect(hiddenByStep('#form-qr-enabled')).toBe(true);

    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: { id: 'exh-new' } });
    await clickFooter('发布展会');

    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.id).toBe('');
    expect(payload.title).toBe('自动化测试展');
    expect(payload.category).toBe('智能家居');
    expect(payload.date).toBe(iso(3));
    // 路由行为不变：创建成功后换成编辑地址，页脚回到「保存展会」。
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-new'));
    await flush();
    expect(document.querySelector('.create-progress')).toBeNull();
    expect(footerButtons()).toEqual(['保存展会']);
  });

  it('离开时选「保存」校验失败，会切到出错字段所在的那一步', async () => {
    // 内存稿里的报名截止早于开始：整表校验会停在第二步的字段上。
    stashExhibitionDraft({
      id: '',
      title: '草稿展会',
      venue: '草稿展馆',
      date: iso(3),
      endDate: '',
      time: '',
      status: 'review',
      category: '智能家居',
      description: '',
      imageUri: '',
      registrationStart: iso(3),
      registrationEnd: iso(1),
      qrEnabled: false,
      allowCancel: true,
      fields: [],
    });
    const router = await mountPage();
    expect(inputValue('form-title')).toBe('草稿展会');
    expect(currentStep()).toBe('基本信息');

    await router.push('/exhibitor');
    await flush();
    clickSheetAction('保存');

    await vi.waitFor(() => expect(sheet.current).toBeNull());
    await flush();
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/exhibition-form');
    // 不通过的字段在第二步：切过去，红框与说明才看得见。
    expect(currentStep()).toBe('报名配置');
    expect(hiddenByStep('#form-reg-end')).toBe(false);
    expect(trigger('form-reg-end').closest('.field')?.getAttribute('data-invalid')).toBe('true');
  });

  it('发布前整表校验失败时退回出错的那一步', async () => {
    await mountPage();
    // 先按不限展期填一场 7 天的展会。
    await fillStepOne({ endOffset: 9 });
    await clickFooter('继续');
    await clickFooter('继续');
    expect(currentStep()).toBe('发布检查');

    // 第三步期间服务端把最长展期改成 3 天：发布前整表再校一次必须发现问题。
    useBootstrapStore().exhibitor.maxExhibitionDays = 3;
    await flush();
    await clickFooter('发布展会');

    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(currentStep()).toBe('基本信息');
    expect(hiddenByStep('#form-end-date')).toBe(false);
    expect(trigger('form-end-date').closest('.field')?.getAttribute('data-invalid')).toBe('true');
    expect(trigger('form-end-date').closest('.field')?.querySelector('.field-error')?.textContent).toContain(
      '请缩短展期',
    );
  });
});

describe('编辑已有展会：仍用分组表单', () => {
  it('不显示三步进度，页脚是「保存展会」，各分组一次可见', async () => {
    const router = await mountEdit();

    expect(document.querySelector('.create-progress')).toBeNull();
    expect(document.querySelector('.create-heading')).toBeNull();
    expect(footerButtons()).toEqual(['保存展会']);
    expect(hiddenByStep('#form-title')).toBe(false);
    expect(hiddenByStep('#form-reg-start')).toBe(false);
    expect(hiddenByStep('#form-description')).toBe(false);
    expect(hiddenByStep('#form-registration-notice')).toBe(false);
    expect(document.querySelector('#form-test')?.textContent).toContain('报名设置');
    expect(document.querySelector('#form-test')?.textContent).toContain('报名收集项');
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
  });
});
