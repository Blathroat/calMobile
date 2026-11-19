/**
 * 头像裁剪面板必须挂到 body 级。
 *
 * 页面容器 `.route-enter.page-surface` 带着填充到结束态的 transform 动画：动画播完后
 * 计算值仍是恒等矩阵，会继续充当 `position: fixed` 的包含块。面板若留在页面里，遮罩与
 * 面板会被压进页面内容区（缩一圈、只盖内容高度），所以这里钉住「渲染到 body、页面容器
 * 里没有遮罩」，并确认取消时弹出退场状态与 close 事件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import AvatarCropper from './AvatarCropper.vue';

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

let app: App | undefined;
let closed: ReturnType<typeof ref<boolean>>;

beforeEach(() => {
  closed = ref(false);
  // 减少动效：退场计时器直接落 0，断言不用等 220ms。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 模拟页面容器带 transform 的挂载方式。 */
function mount(): void {
  document.body.innerHTML = '<div id="host"></div>';
  app = createApp({
    render: () =>
      h('div', { id: 'page-surface', style: 'transform: translate3d(0, 0, 0)' }, [
        h(AvatarCropper, {
          source: 'data:image/png;base64,AAAA',
          onClose: () => {
            closed.value = true;
          },
        }),
      ]),
  });
  app.mount(document.getElementById('host')!);
}

async function flush(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
}

describe('头像裁剪面板的挂载位置', () => {
  it('渲染到 body 级，页面容器里没有遮罩（否则 fixed 会被页面 transform 收成一小块）', async () => {
    mount();
    await flush();
    const sheet = document.querySelector<HTMLElement>('.sheet');
    expect(sheet).not.toBeNull();
    // Teleport 到 body：直接父级就是 body，页面容器里查不到。
    expect(sheet?.parentElement).toBe(document.body);
    expect(document.querySelector('#page-surface .sheet')).toBeNull();
    expect(sheet?.querySelector('.crop-stage')).not.toBeNull();
  });

  it('点取消进入退场状态并回抛 close，由调用方卸载', async () => {
    mount();
    await flush();
    const sheet = document.querySelector<HTMLElement>('.sheet')!;
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
      (item) => item.textContent?.trim() === 'common.cancel',
    );
    expect(cancel).toBeDefined();
    cancel!.click();
    await flush();
    expect(sheet.getAttribute('data-closing')).toBe('true');
    expect(closed.value).toBe(true);
  });
});
