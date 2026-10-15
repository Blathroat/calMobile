import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
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
  window.CalMobileStrings = {
    s_1kqdxz5: '保存简介',
    s_k2jp4x: '预览',
    s_ajd5o: '继续编辑',
    s_p9fllo: '新建展会',
  };
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
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/rich-editor', component: RichEditorPage },
    { path: '/exhibition-form', component: { template: '<div />' } },
    { path: '/exhibition-form/:id', component: { template: '<div />' } },
  ] });
  await router.push('/exhibition-form');
  await router.push(path);
  app = createApp(RichEditorPage).use(pinia).use(router);
  app.mount('#editor-test');
  await nextTick();
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
    vi.mocked(api.exhibitions.get).mockReturnValue(new Promise((resolve) => { resolveDetail = resolve; }));
    await mountEditor();
    const save = document.querySelector<HTMLButtonElement>('#app-foot button');
    expect(save?.disabled).toBe(true);
    save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(api.exhibitions.save).not.toHaveBeenCalled();
    resolveDetail({ found: true, exhibition: { id: 'exh-1', title: '秋季展会', description: '原简介', descriptionFormat: 'md' } });
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('原简介'));
    expect(document.querySelector<HTMLButtonElement>('#app-foot button')?.disabled).toBe(false);
  });

  it('历史 HTML 打开再保存仍保留链接、图片、视频和格式', async () => {
    vi.mocked(api.exhibitions.get).mockResolvedValue({ found: true, exhibition: {
      id: 'exh-1', title: '秋季展会', descriptionFormat: 'html',
      description: '<h2>展会亮点</h2><p><em>欢迎</em> <a href="https://example.com/info">详情</a></p>'
        + '<p><img src="https://example.com/cover.jpg" alt="封面"></p>'
        + '<video controls src="https://example.com/demo.mp4"></video>',
    } });
    await mountEditor();
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('https://example.com/info'));
    const preview = document.querySelector<HTMLButtonElement>('button[title="预览"]');
    expect(preview?.classList.contains('ghost')).toBe(true);
    expect(document.querySelector('.toolbar')?.textContent).not.toContain('粘贴');
    expect(document.querySelectorAll('.action-row > button')).toHaveLength(2);
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
      status: '需审核',
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
    expect(document.querySelector('.card strong')?.textContent).toBe('新展会');
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
});
