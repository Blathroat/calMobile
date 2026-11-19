/**
 * 头像图片失败回退：有地址时显示图片；图片 404 / 解码失败后移除破图、换成昵称首字，
 * 换头像（src 变化）后重新尝试。jsdom 不会真的加载图片，这里直接派发 <img> 的 error。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue';
import AvatarBox from './AvatarBox.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mount(src = '', name = '张三'): Promise<void> {
  document.body.innerHTML = '<div id="avatar-test"></div>';
  app = createApp(AvatarBox, { src, name });
  app.mount('#avatar-test');
  await nextTick();
}

/** 用响应式 src 挂载，验证换头像后重新尝试加载。 */
async function mountLive(initial: string, name = '张三'): Promise<Ref<string>> {
  document.body.innerHTML = '<div id="avatar-test"></div>';
  const src = ref(initial);
  app = createApp({ render: () => h(AvatarBox, { src: src.value, name }) });
  app.mount('#avatar-test');
  await nextTick();
  return src;
}

function avatar(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.avatar');
  if (!node) throw new Error('找不到头像容器');
  return node;
}

function image(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('.avatar img');
}

function initialText(): string {
  return avatar().textContent?.trim() ?? '';
}

/** 派发图片的 error，模拟链接取不到内容（404 / 解码失败）。 */
async function fireError(): Promise<void> {
  const node = image();
  if (!node) throw new Error('找不到头像图片');
  node.dispatchEvent(new Event('error'));
  await nextTick();
}

describe('头像图片失败回退', () => {
  it('有头像地址时渲染图片，不显示首字', async () => {
    await mount('/media/avatar.jpg');
    expect(image()?.getAttribute('src')).toBe('/media/avatar.jpg');
    expect(avatar().classList.contains('has-image')).toBe(true);
    expect(initialText()).toBe('');
  });

  it('图片加载失败后移除破图，换成昵称首字', async () => {
    await mount('/media/avatar.jpg');
    await fireError();
    expect(image()).toBeNull();
    expect(initialText()).toBe('张');
    // 回落后不再带 has-image，边框与无头像时一致。
    expect(avatar().classList.contains('has-image')).toBe(false);
  });

  it('换头像（src 变化）后重新尝试加载', async () => {
    const src = await mountLive('/media/broken.jpg');
    await fireError();
    expect(image()).toBeNull();
    expect(initialText()).toBe('张');

    src.value = '/media/avatar.jpg';
    await nextTick();
    expect(image()?.getAttribute('src')).toBe('/media/avatar.jpg');
    expect(avatar().classList.contains('has-image')).toBe(true);
    expect(initialText()).toBe('');
  });

  it('没有头像地址时直接显示昵称首字', async () => {
    await mount('');
    expect(image()).toBeNull();
    expect(initialText()).toBe('张');
    expect(avatar().classList.contains('has-image')).toBe(false);
  });

  it('换头像后旧图片迟到的 error 不影响新图片', async () => {
    const src = await mountLive('/media/broken.jpg');
    const stale = image();
    if (!stale) throw new Error('找不到旧头像图片');

    src.value = '/media/avatar.jpg';
    await nextTick();
    stale.dispatchEvent(new Event('error'));
    await nextTick();

    expect(image()?.getAttribute('src')).toBe('/media/avatar.jpg');
    expect(avatar().classList.contains('has-image')).toBe(true);
    expect(initialText()).toBe('');
  });

  it('图片失败回落后 aria-label 保持不变', async () => {
    await mount('/media/avatar.jpg', '张三');
    expect(avatar().getAttribute('aria-label')).toBe('张三的头像');
    await fireError();
    expect(avatar().getAttribute('aria-label')).toBe('张三的头像');
  });
});
