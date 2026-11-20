import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';
import RichEditorPage from './RichEditorPage.vue';
import { api } from '@/app/runtime';
import { clearExhibitionDraft, readExhibitionDraft, stashExhibitionDraft } from '@/services/exhibition-draft';
import { loadHtmlConverter, loadMarkdownParser, markdownToHtml } from '@/services/markdown';
import type { ExhibitionDetail } from '@/api/types';

vi.mock('@/app/runtime', () => ({
  api: { exhibitions: { get: vi.fn(), save: vi.fn() } },
}));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

let app: App | undefined;

beforeEach(async () => {
  document.body.innerHTML = '<div id="app-foot"></div><div id="editor-test"></div>';
  vi.clearAllMocks();
  await loadMarkdownParser();
  await loadHtmlConverter();
  vi.mocked(api.exhibitions.save).mockResolvedValue({ ok: true });
  clearExhibitionDraft();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  clearExhibitionDraft();
});

async function mountEditor(path = '/rich-editor?id=exh-1'): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/rich-editor', component: RichEditorPage },
      { path: '/exhibition-form', component: { template: '<div />' } },
      { path: '/exhibition-form/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/exhibition-form');
  await router.push(path);
  // 页面挂在 RouterView 里：onBeforeRouteLeave 需要一条激活的路由记录，直接挂组件会报 R0020。
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router);
  app.mount('#editor-test');
  await nextTick();
}

/** 编辑已有展会时表单存下的内存稿：带展会 id 与纯文本框里的当前正文。 */
function stashEditDraft(description: string, id = 'exh-1'): void {
  stashExhibitionDraft({
    id,
    title: '秋季展会',
    venue: '测试展馆',
    date: '2026-11-20',
    time: '09:00-17:00',
    status: 'review',
    category: '',
    description,
    imageUri: '',
    registrationStart: '',
    registrationEnd: '',
    qrEnabled: false,
    allowCancel: true,
    fields: [],
  });
}

describe('简介加载、编辑与保存', () => {
  it('地址缺少展会标识时不给出可编辑或可保存的空表单', async () => {
    await mountEditor('/rich-editor');
    expect(api.exhibitions.get).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('#app-foot button')).toBeNull();
  });

  it('取回原简介前不能保存空正文', async () => {
    let resolveDetail!: (value: ExhibitionDetail) => void;
    vi.mocked(api.exhibitions.get).mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );
    await mountEditor();
    const save = document.querySelector<HTMLButtonElement>('#app-foot button');
    expect(save?.disabled).toBe(true);
    save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    resolveDetail({
      found: true,
      exhibition: { id: 'exh-1', title: '秋季展会', description: '原简介', descriptionFormat: 'md' },
    });
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('原简介'));
    expect(document.querySelector<HTMLButtonElement>('#app-foot button')?.disabled).toBe(false);
  });

  it('页面顶部不再有展会标题卡，工具条直接跟在顶栏下面', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      found: true,
      exhibition: { id: 'exh-1', title: '秋季展会', description: '原简介', descriptionFormat: 'md' },
    });
    await mountEditor();
    await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());

    const host = document.querySelector('#editor-test')!;
    // 标题由外壳顶栏负责：页面里不再有一张写着展会名称的标题卡。
    expect(host.querySelector('.card')).toBeNull();
    expect(host.textContent).not.toContain('秋季展会');
    // 去掉标题卡后工具条就是页面第一个元素，加载与保存流程不受影响。
    expect(host.firstElementChild?.classList.contains('toolbar')).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('原简介');
    expect(document.querySelector<HTMLButtonElement>('#app-foot button')?.disabled).toBe(false);
  });

  it('历史 HTML 打开再保存仍保留链接、图片、视频和格式', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      found: true,
      exhibition: {
        id: 'exh-1',
        title: '秋季展会',
        descriptionFormat: 'html',
        description:
          '<h2>展会亮点</h2><p><em>欢迎</em> <a href="https://example.com/info">详情</a></p>' +
          '<p><img src="https://example.com/cover.jpg" alt="封面"></p>' +
          '<video controls src="https://example.com/demo.mp4"></video>',
      },
    });
    await mountEditor();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('https://example.com/info'),
    );
    const preview = document.querySelector<HTMLButtonElement>('button[title="预览"]');
    expect(preview?.classList.contains('ghost')).toBe(true);
    expect(document.querySelector('.toolbar')?.textContent).not.toContain('粘贴');
    expect(document.querySelectorAll('.action-row > button')).toHaveLength(2);
    // 这一行不在 .card 里，靠 data-fill 改回「等宽铺满」。
    expect(document.querySelector('.action-row')?.getAttribute('data-fill')).toBe('true');
    preview?.click();
    await nextTick();
    expect(preview?.textContent).toContain('继续编辑');
    expect(preview?.classList.contains('ghost')).toBe(false);
    expect(document.querySelector('.rich-content em')?.textContent).toBe('欢迎');
    expect(document.querySelector('.rich-content video')?.getAttribute('src')).toBe('https://example.com/demo.mp4');
    preview?.click();
    await nextTick();
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.querySelector('.rich-content')).toBeNull();
    document.querySelector<HTMLButtonElement>('#app-foot button')?.click();
    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledOnce());
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0];
    expect(payload.descriptionFormat).toBe('md');
    const saved = document.createElement('div');
    saved.innerHTML = markdownToHtml(String(payload.description));
    expect(saved.querySelector('a')?.getAttribute('href')).toBe('https://example.com/info');
    expect(saved.querySelector('img')?.getAttribute('src')).toBe('https://example.com/cover.jpg');
    expect(saved.querySelector('video')?.getAttribute('src')).toBe('https://example.com/demo.mp4');
  });

  it('新建展会没有 id 时把简介写回稿，不请求保存接口', async () => {
    stashExhibitionDraft({
      title: '新展会',
      venue: '',
      date: '',
      time: '09:00-17:00',
      status: 'review',
      category: '',
      description: '草稿',
      imageUri: '',
      registrationStart: '',
      registrationEnd: '',
      qrEnabled: false,
      allowCancel: true,
      fields: [],
    });
    await mountEditor('/rich-editor?draft=1');
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('草稿'));
    // 新建展会同样不再显示标题卡：顶栏已经写着「编辑展会简介」。
    expect(document.querySelector('.card')).toBeNull();
    const area = document.querySelector<HTMLTextAreaElement>('textarea');
    if (!area) throw new Error('缺少编辑区');
    area.value = '改过的简介';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('#app-foot button')?.click();
    await vi.waitFor(() => expect(readExhibitionDraft()?.description).toBe('改过的简介'));
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    expect(api.exhibitions.get).not.toHaveBeenCalled();
  });

  it('编辑已有展会且带 ?draft=1 时用草稿正文起稿，保存后把最新正文写回草稿', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      found: true,
      exhibition: {
        id: 'exh-1',
        title: '秋季展会',
        venue: '测试展馆',
        description: '服务端简介',
        descriptionFormat: 'md',
      },
    });
    stashEditDraft('文本框里刚写的简介');
    await mountEditor('/rich-editor?id=exh-1&draft=1');
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('文本框里刚写的简介'),
    );
    // 详情照常请求：保存 payload 里的其它字段仍来自服务端。
    expect(api.exhibitions.get).toHaveBeenCalledWith('exh-1');

    const area = document.querySelector<HTMLTextAreaElement>('textarea');
    if (!area) throw new Error('缺少编辑区');
    area.value = '编辑器里改过的简介';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('#app-foot button')?.click();
    await vi.waitFor(() => expect(api.exhibitions.save).toHaveBeenCalledOnce());
    const payload = vi.mocked(api.exhibitions.save).mock.calls[0]![0];
    expect(payload.description).toBe('编辑器里改过的简介');
    expect(payload.venue).toBe('测试展馆');
    // 正文落库后不清草稿：返回表单要靠它恢复其他还没保存的字段，最新简介也在里面。
    await vi.waitFor(() => expect(readExhibitionDraft()?.description).toBe('编辑器里改过的简介'));
    expect(readExhibitionDraft()?.id).toBe('exh-1');
  });

  it('草稿记的不是当前展会时不用它起稿，仍显示服务端正文', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      found: true,
      exhibition: { id: 'exh-1', title: '秋季展会', description: '服务端简介', descriptionFormat: 'md' },
    });
    stashEditDraft('别的展会草稿', 'exh-2');
    await mountEditor('/rich-editor?id=exh-1&draft=1');
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('服务端简介'));
    expect(readExhibitionDraft()?.id).toBe('exh-2');
  });

  it('编辑模式没保存就离开编辑器时草稿留给表单，不随卸载清掉', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({
      found: true,
      exhibition: { id: 'exh-1', title: '秋季展会', description: '服务端简介', descriptionFormat: 'md' },
    });
    stashEditDraft('还没保存的简介');
    await mountEditor('/rich-editor?id=exh-1&draft=1');
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('还没保存的简介'),
    );
    expect(readExhibitionDraft()).not.toBeNull();

    // 卸载本身不再清草稿：回表单的路由目标才是判断依据（见 ExhibitionFormPage 的往返用例）。
    app?.unmount();
    app = undefined;
    expect(readExhibitionDraft()).not.toBeNull();
    expect(readExhibitionDraft()?.description).toBe('还没保存的简介');
  });
});
