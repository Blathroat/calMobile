/**
 * 海报缩略图的比例自适应：高度固定，宽度由真实比例收进 9:16～3:4（纵向）后算出来。
 *
 * jsdom 不会真的解码图片，这里直接给 `<img>` 定义自然尺寸再派发 load / error，
 * 只验证组件算出的行内 `aspect-ratio`。样式（高度、宽度推算、cover 裁切）在
 * `styles/base.css` 的 `.thumb` 上。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import MediaBox from './MediaBox.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await nextTick();
}

function mount(src = ''): void {
  document.body.innerHTML = '<div id="media-test"></div>';
  app = createApp(MediaBox, { src, alt: '海报' });
  app.mount('#media-test');
}

function box(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.ph-img');
  if (!node) throw new Error('找不到缩略图容器');
  return node;
}

/** CSSOM 会把比例序列化成 `0.5625 / 1`，这里只取数值部分比较。 */
function ratioValue(): number | undefined {
  const raw = box().style.aspectRatio;
  if (!raw) return undefined;
  const value = Number(raw.split('/')[0]?.trim());
  return Number.isFinite(value) ? value : undefined;
}

function image(): HTMLImageElement {
  const node = document.querySelector('img');
  if (!node) throw new Error('找不到缩略图');
  return node;
}

async function fireLoad(width: number, height: number): Promise<void> {
  const node = image();
  Object.defineProperty(node, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(node, 'naturalHeight', { configurable: true, value: height });
  node.dispatchEvent(new Event('load'));
  await flush();
}

describe('海报缩略图比例', () => {
  it('没有图时不给行内比例：占位槽位沿用 CSS 的 9:16', () => {
    mount('');
    expect(ratioValue()).toBeUndefined();
  });

  it('正好 9:16 的海报保持 9:16', async () => {
    mount('/media/a.jpg');
    await fireLoad(1080, 1920);
    expect(ratioValue()).toBe(0.5625);
  });

  it('3:4 纵向的海报用区间最宽的一端', async () => {
    mount('/media/a.jpg');
    await fireLoad(1200, 1600);
    expect(ratioValue()).toBe(0.75);
  });

  it('区间内的其它比例按真实比例展示', async () => {
    mount('/media/a.jpg');
    await fireLoad(1000, 1500);
    expect(ratioValue()).toBeCloseTo(1000 / 1500, 10);
  });

  it('过宽的海报（横幅）按 3:4 填满，不把卡片撑成横图', async () => {
    mount('/media/a.jpg');
    await fireLoad(1920, 1080);
    expect(ratioValue()).toBe(0.75);
  });

  it('过长的海报按 9:16 填满，不让缩略图比卡片还高', async () => {
    mount('/media/a.jpg');
    await fireLoad(1080, 2400);
    expect(ratioValue()).toBe(0.5625);
  });

  it('加载失败时回到占位比例', async () => {
    mount('/media/a.jpg');
    await fireLoad(1200, 1600);
    expect(ratioValue()).toBe(0.75);
    image().dispatchEvent(new Event('error'));
    await flush();
    expect(ratioValue()).toBe(0.5625);
  });
});
