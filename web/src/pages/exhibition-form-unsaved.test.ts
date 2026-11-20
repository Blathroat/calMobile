/**
 * 编辑展会页：未保存修改的离开提示与 Markdown 简介往返。
 *
 * 覆盖的规则：
 * - 有改动时切换页面 / 返回先取消导航，弹抽屉「保存 / 不保存 / 取消」（竖排三颗按钮）；
 * - 取消留在本页；不保存直接离开且不调保存接口；保存先走与页脚保存相同的校验与接口，成功后再去目标；
 * - 校验失败 / 接口失败留在本页，不重复弹提示；保存中反复点击只发一次请求；
 * - 没有改动、去 Markdown 简介编辑器、受限 / 加载失败 / 不存在这几种状态离开都不弹；
 * - 简介编辑器是同一份草稿流程：去时不提示也不清草稿，从它返回后其他未保存字段仍在，
 *   再离开仍会提示（新建与编辑两条路径都覆盖，编辑路径用真实编辑器走一遍保存）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import ExhibitionFormPage from './ExhibitionFormPage.vue';
import RichEditorPage from './RichEditorPage.vue';
import AppSheet from '@/components/AppSheet.vue';
import { navigation } from '@/app/navigation';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import {
  clearExhibitionDraft,
  patchExhibitionDraft,
  readExhibitionDraft,
  stashExhibitionDraft,
  type ExhibitionDraft,
} from '@/services/exhibition-draft';
import { loadMarkdownParser } from '@/services/markdown';
import { closeSheet, sheet } from '@/services/sheet';
import { api } from '@/app/runtime';
import type { ApiResult } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: {
    exhibitions: { save: vi.fn(), remove: vi.fn(), get: vi.fn() },
    media: { upload: vi.fn() },
  },
}));
vi.mock('@/services/device-services', () => ({
  device: { importMedia: vi.fn(), discardMedia: vi.fn() },
}));

const blank = defineComponent({ render: () => h('div') });

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearExhibitionDraft();
  document.body.innerHTML = '<div id="app-foot"></div><div id="app-top-actions"></div><div id="form-test"></div>';
  // 抽屉的退场动画按 prefers-reduced-motion 走 0ms，用例不必等 220ms。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(async () => {
  app?.unmount();
  app = undefined;
  // 抽屉状态在模块级：用例里打开的抽屉要收掉，否则会漏到下一个用例。
  if (sheet.current) closeSheet();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  navigation.cancel();
  vi.unstubAllGlobals();
  clearExhibitionDraft();
  document.body.innerHTML = '';
});

/** 等微任务、重渲染与抽屉退场的 0ms 定时器都跑完。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
}

/** 挂载表单页（连同共享抽屉）；`prepare` 在 pinia 就绪后、路由进入前执行。 */
async function mountForm(
  path = '/exhibition-form',
  prepare?: () => void,
  options: { richEditor?: boolean } = {},
): Promise<Router> {
  const pinia = createPinia();
  setActivePinia(pinia);
  prepare?.();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      // 首页：浏览器返回键从这里开始（内存路由的初始位置），返回时才有真实目标。
      { path: '/', component: blank },
      { path: '/exhibition-form', component: ExhibitionFormPage },
      { path: '/exhibition-form/:id', component: ExhibitionFormPage },
      { path: '/rich-editor', component: options.richEditor ? RichEditorPage : blank },
      { path: '/exhibitor', component: blank },
    ],
  });
  router.beforeEach(() => {
    navigation.begin();
  });
  // 先落一条首页历史：浏览器返回键从表单回首页，测试里 back() 才有真实目标。
  await router.push('/');
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
  useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
  useBootstrapStore().apply({ categories: ['智能家居', '物流技术'] });
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

/** 打开编辑页并等首屏数据落模型（基线这时才拍好）。 */
async function mountEditExhibition(): Promise<Router> {
  const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition);
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#form-title')?.value).toBe('秋季展会'));
  return router;
}

/** 与 exh-1 匹配的一份内存稿，默认内容和服务端一致，只用于覆盖成「改过」的版本。 */
function draftFor(id: string, overrides: Partial<ExhibitionDraft> = {}): ExhibitionDraft {
  return {
    id,
    title: '秋季展会',
    venue: '上海新国际博览中心',
    date: '2026-11-20',
    endDate: '2026-11-22',
    time: '',
    status: 'review',
    category: '智能家居',
    description: '服务端简介',
    imageUri: '',
    registrationStart: '',
    registrationEnd: '',
    qrEnabled: false,
    allowCancel: true,
    fields: [],
    ...overrides,
  };
}

/** 等详情接口被调用指定次数（每次都是新一轮取数），再等基线落下。 */
async function waitForDetailLoads(times: number): Promise<void> {
  await vi.waitFor(() => expect(vi.mocked(api.exhibitions.get).mock.calls.length).toBe(times));
  await flush();
}

function trigger(id: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`#${id}`);
  if (!element) throw new Error(`缺少触发按钮 #${id}`);
  return element;
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

function dayButton(isoDate: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  if (!button) throw new Error(`抽屉里没有 ${isoDate} 这一天`);
  return button;
}

/** 往输入框（含 textarea）填值并触发 input 事件，模拟用户打字。 */
function fill(id: string, value: string): void {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!input) throw new Error(`缺少输入框 #${id}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function inputValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? '';
}

function editDescriptionButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#form-test button')].find(
    (item) => item.textContent?.trim() === '使用Markdown编辑简介',
  );
  if (!button) throw new Error('活动信息卡里缺少「使用Markdown编辑简介」入口');
  return button;
}

/** 简介编辑器页脚那颗「保存简介」。 */
function editorSaveButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#app-foot button')].find(
    (item) => item.textContent?.trim() === '保存简介',
  );
  if (!button) throw new Error('#app-foot 里缺少「保存简介」按钮');
  return button;
}

function sheetLabels(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].map(
    (item) => item.textContent?.trim() ?? '',
  );
}

function clickSheetAction(label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`抽屉里没有「${label}」按钮`);
  button.click();
}

/** 分类是必填项：打开分类抽屉选一个（保存前要补上）。 */
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

describe('编辑展会：未保存就离开', () => {
  it('有改动时离开先取消导航，弹抽屉并给出「保存 / 不保存 / 取消」', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();

    await router.push('/exhibitor');
    await flush();

    // 这次导航被取消，人还留在编辑页。
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(sheet.current?.title).toBe('有未保存的修改');
    expect(sheet.current?.message).toBe('离开后，未保存的修改会丢失。');
    // 三颗按钮竖排：文案长短不一，并排会挤。
    expect(sheet.current?.layout).toBe('row');
    expect(sheet.current?.actions.map((action) => action.label)).toEqual(['保存', '不保存', '取消']);
    // 抽屉真的渲染出来了：说明文字与按钮次序都对。
    expect(sheetLabels()).toEqual(['保存', '不保存', '取消']);
    expect(document.querySelector('.sheet-panel')?.textContent).toContain('离开后，未保存的修改会丢失。');
  });

  it('选「取消」留在原页，改动还在', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();

    await router.push('/exhibitor');
    await flush();
    clickSheetAction('取消');
    await flush();

    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(sheet.current).toBeNull();
    expect(inputValue('form-title')).toBe('改过的标题');
  });

  it('选「不保存」直接离开，不调保存接口', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();

    await router.push('/exhibitor');
    await flush();
    clickSheetAction('不保存');
    await flush();

    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(api.exhibitions.save).not.toHaveBeenCalled();
  });

  it('选「保存」先保存接口再导航；校验与保存按钮同一条路', async () => {
    const router = await mountEditExhibition();
    vi.mocked(api.exhibitions.save).mockResolvedValue({
      ok: true,
      exhibition: { id: 'exh-1', description: '服务端简介', imageUri: '' },
    });
    fill('form-title', '改过的标题');
    await flush();

    await router.push('/exhibitor');
    await flush();
    clickSheetAction('保存');

    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.id).toBe('exh-1');
    expect(payload.title).toBe('改过的标题');
    expect(readExhibitionDraft()).toBeNull();
  });

  it('新建页选「保存」保存后去的是目标路由，不是新建展会的编辑地址', async () => {
    const router = await mountForm('/exhibition-form', () => {
      useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
      useBootstrapStore().apply({ categories: ['智能家居'] });
    });
    fill('form-title', '新建展会');
    fill('form-venue', '上海新国际博览中心');
    // 开展日期：点一天后用「取消」收起，闭展保持空串（单日展会）。
    trigger('form-date').click();
    await flush();
    dayButton(iso(3)).click();
    await flush();
    clickSheetAction('取消');
    await flush();
    await pickCategory();
    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: { id: 'exh-new' } });

    await router.push('/exhibitor');
    await flush();
    expect(sheet.current?.title).toBe('有未保存的修改');
    clickSheetAction('保存');

    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    expect(router.currentRoute.value.path).not.toBe('/exhibition-form/exh-new');
  });

  it('浏览器 / 顶部返回键同样被拦下', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();

    router.back();
    await flush();

    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(sheet.current?.title).toBe('有未保存的修改');
  });

  it('切换报名方式即时保存成功后，再离开不算未保存', async () => {
    const router = await mountEditExhibition();
    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: { id: 'exh-1' } });
    const optional = document.querySelector<HTMLButtonElement>('.seg button[data-value="optional"]');
    if (!optional) throw new Error('缺少「无需审核」报名方式');
    optional.click();
    // 改报名方式会立即保存整份 payload：成功后当前内容就是新的已保存基线。
    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    await flush();

    await router.push('/exhibitor');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
  });

  it('删除展会成功后离开，不弹未保存提示', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();
    vi.mocked(api.exhibitions.remove).mockResolvedValue({ ok: true });
    const deleteButton = [...document.querySelectorAll<HTMLButtonElement>('#form-test button')].find(
      (item) => item.textContent?.trim() === '删除展会',
    );
    if (!deleteButton) throw new Error('页面底部缺少「删除展会」');
    deleteButton.click();
    await flush();
    clickSheetAction('删除');

    await vi.waitFor(() => expect(api.exhibitions.remove).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    await flush();
    expect(sheet.current).toBeNull();
    expect(readExhibitionDraft()).toBeNull();
  });

  it('没有改动时离开不弹提示', async () => {
    const router = await mountEditExhibition();
    await router.push('/exhibitor');
    await flush();

    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
  });

  it('校验失败（名称被清空）时不出保存请求、留在本页且不重复弹提示', async () => {
    const router = await mountEditExhibition();
    // 名称必填：清空后保存会先在原位报错。
    fill('form-title', '');
    await flush();
    await router.push('/exhibitor');
    await flush();
    clickSheetAction('保存');
    await flush();

    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(sheet.current).toBeNull();
    // 名称字段没有独立说明行：红框（data-invalid）表示原位报错。
    const titleField = document.querySelector('#form-title')?.closest('.field');
    expect(titleField?.getAttribute('data-invalid')).toBe('true');
  });

  it('接口失败时留在本页，不跳走、不再弹第二个提示', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();
    await router.push('/exhibitor');
    await flush();
    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: false, error: '保存失败' });
    clickSheetAction('保存');

    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1');
    expect(sheet.current).toBeNull();
    expect(document.querySelector('#form-test')?.textContent).toContain('保存失败');
  });

  it('保存中重复点「保存」只发一次请求、只导航一次', async () => {
    const router = await mountEditExhibition();
    fill('form-title', '改过的标题');
    await flush();
    await router.push('/exhibitor');
    await flush();

    const saveAction = sheet.current?.actions[0];
    if (!saveAction) throw new Error('抽屉里缺少「保存」动作');
    let finish!: (value: ApiResult) => void;
    vi.mocked(api.exhibitions.save).mockReturnValue(
      new Promise<ApiResult>((resolve) => {
        finish = resolve;
      }),
    );
    clickSheetAction('保存');
    // 第一次点击已经开始保存：保存中再触发一次，不能再发请求，也不能多跳一次。
    await saveAction.onClick?.(() => undefined);
    expect(api.exhibitions.save).toHaveBeenCalledTimes(1);

    finish({ ok: true, exhibition: { id: 'exh-1' } });
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
  });
});

describe('编辑展会：Markdown 简介往返', () => {
  it('去简介编辑器不弹提示，也不清内存稿', async () => {
    const router = await mountForm();
    fill('form-title', '草稿展会');
    await flush();

    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));

    expect(sheet.current).toBeNull();
    expect(readExhibitionDraft()?.title).toBe('草稿展会');
  });

  it('从简介编辑器返回后，再离开仍会提示', async () => {
    const router = await mountForm();
    fill('form-title', '草稿展会');
    await flush();
    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));

    // 从二级页返回主编辑页：填回内存稿，不弹提示。
    await router.push('/exhibition-form');
    await flush();
    expect(sheet.current).toBeNull();
    expect(inputValue('form-title')).toBe('草稿展会');

    // 还是没保存就离开：这次要提示。
    await router.push('/exhibitor');
    await flush();
    expect(sheet.current?.title).toBe('有未保存的修改');

    // 选「不保存」：草稿随离开清掉。
    clickSheetAction('不保存');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(readExhibitionDraft()).toBeNull();
    expect(api.exhibitions.save).not.toHaveBeenCalled();
  });

  it('编辑已有展会：经简介编辑器往返后其他未保存字段仍在，再离开仍提示', async () => {
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition);
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('#form-description')?.value).toBe('服务端简介'),
    );
    fill('form-title', '未保存的新标题');
    fill('form-registration-notice', '未保存的参与方式');
    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    // 模拟二级页保存简介：只把最新正文写回内存稿，其他字段原样保留。
    patchExhibitionDraft('编辑器里改过的简介');

    await router.push('/exhibition-form/exh-1');
    await flush();
    expect(inputValue('form-title')).toBe('未保存的新标题');
    expect(inputValue('form-description')).toBe('编辑器里改过的简介');
    expect(inputValue('form-registration-notice')).toBe('未保存的参与方式');

    // 详情接口回来后才拍基线；此后仍算「有未保存修改」。
    await waitForDetailLoads(2);
    await router.push('/exhibitor');
    await flush();
    expect(sheet.current?.title).toBe('有未保存的修改');
  });

  it('编辑已有展会：简介编辑器保存后落库、草稿带回表单，字段不丢且仍提示', async () => {
    await loadMarkdownParser();
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition, { richEditor: true });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('#form-description')?.value).toBe('服务端简介'),
    );
    fill('form-title', '未保存的新标题');
    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    // 二级页用内存稿起稿：纯文本框里当前的正文。
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('服务端简介'));

    const area = document.querySelector<HTMLTextAreaElement>('textarea');
    if (!area) throw new Error('缺少简介编辑区');
    area.value = '编辑器里改过的简介';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true, exhibition: { id: 'exh-1' } });
    await vi.waitFor(() => expect(editorSaveButton().disabled).toBe(false));
    editorSaveButton().click();

    // 简介立即写库，而不是只改内存稿。
    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.description).toBe('编辑器里改过的简介');
    // 保存后回到编辑表单：最新简介与其他未保存字段都在，内存稿没被清掉。
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibition-form/exh-1'));
    await flush();
    expect(inputValue('form-title')).toBe('未保存的新标题');
    expect(inputValue('form-description')).toBe('编辑器里改过的简介');
    expect(readExhibitionDraft()?.id).toBe('exh-1');
    expect(readExhibitionDraft()?.description).toBe('编辑器里改过的简介');

    // 服务器数据当基线（这份 mock 里服务器简介与标题还是旧的）：再离开仍提示。
    await waitForDetailLoads(3);
    await router.push('/exhibitor');
    await flush();
    expect(sheet.current?.title).toBe('有未保存的修改');
  });

  it('从简介编辑器直接去别的页面时清掉内存稿（这次编辑流程结束）', async () => {
    await loadMarkdownParser();
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition, { richEditor: true });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('#form-description')?.value).toBe('服务端简介'),
    );
    editDescriptionButton().click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/rich-editor'));
    expect(readExhibitionDraft()).not.toBeNull();

    await router.push('/exhibitor');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/exhibitor'));
    expect(readExhibitionDraft()).toBeNull();
  });

  it('内存稿记的不是当前展会时不填回表单', async () => {
    stashExhibitionDraft(draftFor('exh-2', { title: '别的展会草稿' }));
    const router = await mountForm('/exhibition-form/exh-1', prepareEditExhibition);
    await vi.waitFor(() => expect(inputValue('form-title')).toBe('秋季展会'));
    expect(readExhibitionDraft()?.id).toBe('exh-2');

    // 草稿没被采用，表单与服务端一致：离开不提示，顺手清掉不匹配的旧稿。
    await router.push('/exhibitor');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
    expect(readExhibitionDraft()).toBeNull();
  });
});

describe('编辑展会：不弹提示的退出状态', () => {
  it('受限账号退出不弹（整页是说明块，没有可保存的表单）', async () => {
    const router = await mountForm('/exhibition-form/exh-1', () => {
      prepareEditExhibition();
      useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor', can: { limited: true } });
      // 内存稿与服务器不同（脏），但受限状态下也不该弹。
      stashExhibitionDraft(draftFor('exh-1', { title: '草稿里的标题' }));
    });
    await waitForDetailLoads(1);
    expect(document.querySelector('#form-test')?.textContent).toContain('账号已被限制');

    await router.push('/exhibitor');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
  });

  it('加载失败时退出不弹', async () => {
    const router = await mountForm('/exhibition-form/exh-1', () => {
      useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
      vi.mocked(api.exhibitions.get).mockRejectedValue(new Error('网络错误'));
    });
    await vi.waitFor(() => expect(document.querySelector('#form-test')?.textContent).toContain('加载失败'));

    await router.push('/exhibitor');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
  });

  it('展会不存在时退出不弹', async () => {
    const router = await mountForm('/exhibition-form/exh-missing', () => {
      useSessionStore().applyUser({ id: 'exhibitor-1', role: 'exhibitor' });
      vi.mocked(api.exhibitions.get).mockResolvedValue({ found: false, error: '展会不存在' });
    });
    await vi.waitFor(() => expect(document.querySelector('#form-test')?.textContent).toContain('展会不存在'));

    await router.push('/exhibitor');
    await flush();
    expect(router.currentRoute.value.path).toBe('/exhibitor');
    expect(sheet.current).toBeNull();
  });
});
