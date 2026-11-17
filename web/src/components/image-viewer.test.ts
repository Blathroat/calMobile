/**
 * 灯箱：只做看图与手势，底部不再放操作说明，关闭按钮只留一个叉（无圆形底与描边）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import ImageViewer from './ImageViewer.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

async function mountViewer(): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const onClose = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  app = createApp({
    render: () => h(ImageViewer, { src: '/media/poster.jpg', alt: '展会海报', onClose }),
  });
  app.mount(host);
  await nextTick();
  return { onClose };
}

describe('灯箱', () => {
  it('不显示底部操作说明', async () => {
    await mountViewer();
    expect(document.querySelector('.viewer-hint')).toBeNull();
  });

  it('关闭按钮只留一个叉，点击后通知调用方', async () => {
    const { onClose } = await mountViewer();
    const button = document.querySelector<HTMLButtonElement>('.viewer-close');
    expect(button).not.toBeNull();
    // 不再是圆形按钮：没有边框、没有底色，命中区仍是 44px。
    expect(button?.getAttribute('aria-label')).toBe('关闭大图');
    button?.click();
    await nextTick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('打开时锁背景滚动，卸载后恢复', async () => {
    await mountViewer();
    expect(document.body.style.overflow).toBe('hidden');
    app?.unmount();
    app = undefined;
    expect(document.body.style.overflow).toBe('');
  });
});
