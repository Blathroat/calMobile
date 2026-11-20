/**
 * 安装说明抽屉：按 iOS Safari / iOS 其它浏览器 / Android / 桌面给对应步骤；
 * 内置浏览器额外说明装不上。地址复制与「打开完整应用」仍只在报名站入口出现。
 *
 * 这里用真实平台判断（只替换 `navigator.userAgent`），顺带覆盖 Android 识别：
 * 抽屉分支与 `services/platform.ts` 的 UA 判断一起验证。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import PwaInstallSheet from './PwaInstallSheet.vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import { copyText } from '@/services/clipboard';
import { toast } from '@/services/toast';

vi.mock('@/services/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
// 微信内置浏览器：没有 Safari 字样，是 iOS 上装不了的浏览器。
const IPHONE_WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800317d) NetType/WIFI Language/zh_CN';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
const ANDROID_WECHAT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface Stub {
  target: object;
  key: string;
  original: PropertyDescriptor | undefined;
}

const stubs: Stub[] = [];

/** 改一个全局属性并记下原状；afterEach 逆序还原。 */
function stubProperty(target: object, key: string, value: unknown): void {
  stubs.push({ target, key, original: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true });
}

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  for (let index = stubs.length - 1; index >= 0; index -= 1) {
    const stub = stubs[index];
    if (!stub) continue;
    if (stub.original) Object.defineProperty(stub.target, stub.key, stub.original);
    else Reflect.deleteProperty(stub.target, stub.key);
  }
  stubs.length = 0;
  vi.restoreAllMocks();
});

function mountSheet(options: {
  mode: 'app' | 'join';
  userAgent?: string;
  publicBaseUrl?: string;
  copyOk?: boolean;
}): HTMLElement {
  stubProperty(navigator, 'userAgent', options.userAgent ?? DESKTOP_CHROME);
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
  it('iOS Safari：用 Safari 分享面板三步', () => {
    const container = mountSheet({
      mode: 'app',
      userAgent: IPHONE_SAFARI,
      publicBaseUrl: 'https://expo.example.com',
    });
    expect(container.textContent).toContain('用 Safari 打开后添加到主屏幕');
    expect(container.textContent).toContain('用 Safari 打开这个地址');
    expect(container.textContent).toContain('点 Safari 底部的分享按钮');
    expect(container.textContent).toContain('选择「添加到主屏幕」');
    expect(container.textContent).not.toContain('当前浏览器不能直接安装');
    expect(container.textContent).toContain('https://expo.example.com/app/');
    expect(container.querySelectorAll('.pwa-steps > li')).toHaveLength(3);
    expect(button('打开完整应用')).toBeUndefined();
  });

  it('iOS 其它浏览器：先提示换到 Safari，再给同样的三步', () => {
    const container = mountSheet({ mode: 'join', userAgent: IPHONE_WECHAT });
    expect(container.textContent).toContain('当前浏览器不能直接安装。请点右上角「…」→「在 Safari 中打开」');
    expect(container.textContent).toContain('点 Safari 底部的分享按钮');
    expect(container.textContent).not.toContain('添加到主屏幕后，可以像应用一样打开');
    expect(container.querySelectorAll('.pwa-steps > li')).toHaveLength(3);
  });

  it('Android：浏览器菜单三步', () => {
    const container = mountSheet({ mode: 'app', userAgent: ANDROID_CHROME });
    expect(container.textContent).toContain('添加到主屏幕后，可以像应用一样打开');
    expect(container.textContent).toContain('用 Chrome 打开这个地址');
    expect(container.textContent).toContain('点右上角的菜单按钮');
    expect(container.textContent).toContain('选择「添加到主屏幕」或「安装应用」');
    expect(container.textContent).not.toContain('用 Safari 打开这个地址');
    expect(container.textContent).not.toContain('当前浏览器不能直接安装');
    expect(container.querySelectorAll('.pwa-steps > li')).toHaveLength(3);
  });

  it('Android 内置浏览器：步骤照旧，另说明当前浏览器装不上', () => {
    const container = mountSheet({ mode: 'app', userAgent: ANDROID_WECHAT });
    expect(container.textContent).toContain('添加到主屏幕后，可以像应用一样打开');
    expect(container.textContent).toContain('用 Chrome 打开这个地址');
    expect(container.textContent).toContain('当前浏览器不能直接安装');
  });

  it('桌面等其它平台：一段安装说明，不摆 iOS / Android 步骤', () => {
    const container = mountSheet({ mode: 'app', userAgent: DESKTOP_CHROME });
    expect(container.textContent).toContain('在浏览器菜单里安装或添加到主屏幕');
    expect(container.textContent).toContain('在浏览器菜单中选择「安装」或「添加到主屏幕」');
    expect(container.textContent).not.toContain('用 Safari 打开这个地址');
    expect(container.textContent).not.toContain('用 Chrome 打开这个地址');
    // 桌面只有一步：不套序号，单独成段。
    expect(container.querySelectorAll('.pwa-steps > li')).toHaveLength(0);
    expect(container.querySelector('.pwa-step-note')).not.toBeNull();
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
});
