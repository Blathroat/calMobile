/**
 * 图标形状与回退：`chevronDown` 曾经没登记在 PATHS 里，页面上所有展开箭头都回退成
 * info 的圆形感叹号；这里钉住 chevronDown 画的是折线、calendar 仍可用，
 * 以及没登记的名字仍按 info 兜底。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import AppIcon from './AppIcon.vue';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

/** 挂一个图标，返回它的 <svg>；每个用例只挂一个。 */
async function mount(name: string): Promise<SVGSVGElement> {
  document.body.innerHTML = '<div id="icon-test"></div>';
  app = createApp({ render: () => h(AppIcon, { name }) });
  app.mount('#icon-test');
  await nextTick();
  const svg = document.querySelector<SVGSVGElement>('#icon-test svg');
  if (!svg) throw new Error('图标没有渲染成 svg');
  return svg;
}

describe('图标库的形状', () => {
  it('chevronDown 是向下展开的折线，不会回退成 info 的圆', async () => {
    const svg = await mount('chevronDown');
    // info 的兜底是「圆 + 感叹号」：有 <circle> 就说明名字没命中 PATHS。
    expect(svg.querySelector('circle')).toBeNull();
    const paths = [...svg.querySelectorAll('path')];
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toBe('m5 9 7 7 7-7');
  });

  it('calendar 仍可用：画的是带两条挂耳的日历框，不是 info 圆形', async () => {
    const svg = await mount('calendar');
    expect(svg.querySelector('rect')).not.toBeNull();
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M8 3.5v3M16 3.5v3M3.5 10h17');
    expect(svg.querySelector('circle')).toBeNull();
  });

  it('没登记的名字仍回退到 info 的圆形感叹号', async () => {
    const svg = await mount('not-an-icon');
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M12 11v5.5M12 8.2v.01');
  });
});
