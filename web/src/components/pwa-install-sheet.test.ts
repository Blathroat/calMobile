/**
 * 安装说明抽屉：复制的是完整应用地址，成功 / 失败都有提示；非 Safari 先提示换浏览器；
 * 「打开完整应用」只在报名站入口出现。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import PwaInstallSheet from './PwaInstallSheet.vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { copyText } from '@/services/clipboard';
import { isIosSafari } from '@/services/platform';
import { toast } from '@/services/toast';

vi.mock('@/services/platform', () => ({
  isIos: vi.fn(() => true),
  isIosSafari: vi.fn(() => true),
  isStandalonePwa: vi.fn(() => false),
}));
vi.mock('@/services/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountSheet(options: {
  mode: 'app' | 'join';
  publicBaseUrl?: string;
  safari?: boolean;
  copyOk?: boolean;
}): HTMLElement {
  vi.mocked(isIosSafari).mockReturnValue(options.safari !== false);
  vi.mocked(copyText).mockResolvedValue(options.copyOk !== false);
  const pinia = createPinia();
  setActivePinia(pinia);
  useBootstrapStore().publicBaseUrl = options.publicBaseUrl ?? '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render: () => h(PwaInstallSheet, { mode: options.mode }) });
  app.use(pinia).mount(container);
  return container;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await nextTick();
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
}

describe('安装到主屏幕抽屉', () => {
  it('app 模式只讲步骤，不出现「打开完整应用」', () => {
    const container = mountSheet({ mode: 'app', publicBaseUrl: 'https://expo.example.com' });
    expect(container.textContent).toContain('用 Safari 打开后添加到主屏幕');
    expect(container.textContent).toContain('点 Safari 底部的分享按钮');
    expect(container.textContent).toContain('https://expo.example.com/app/');
    expect(button('打开完整应用')).toBeUndefined();
  });

  it('join 模式多一颗「打开完整应用」', () => {
    mountSheet({ mode: 'join', publicBaseUrl: 'https://expo.example.com' });
    expect(button('打开完整应用')).toBeDefined();
  });

  it('复制的是完整应用地址，成功时给成功提示', async () => {
    mountSheet({ mode: 'app', publicBaseUrl: 'https://expo.example.com' });
    button('复制链接')!.click();
    await flush();
    expect(copyText).toHaveBeenCalledWith('https://expo.example.com/app/');
    expect(toast).toHaveBeenCalledWith('链接已复制', 'success');
  });

  it('没配对外域名时复制当前域名下的 /app/，失败时提示手动复制', async () => {
    mountSheet({ mode: 'app', copyOk: false });
    expect(document.body.textContent).toContain(`${window.location.origin}/app/`);
    button('复制链接')!.click();
    await flush();
    expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(toast).toHaveBeenCalledWith('复制失败，请手动选择地址', 'error');
  });

  it('非 Safari 显示换浏览器的说明', () => {
    const nonSafari = mountSheet({ mode: 'join', safari: false });
    expect(nonSafari.textContent).toContain('当前浏览器不能直接安装');
  });

  it('Safari 里不出现换浏览器的说明', () => {
    const safari = mountSheet({ mode: 'join', safari: true });
    expect(safari.textContent).not.toContain('当前浏览器不能直接安装');
  });
});
