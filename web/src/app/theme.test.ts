/**
 * 外观：系统深色的来源与深色下的强调色可读性。
 *
 * 这里钉住三件容易回归的事：
 * 1. auto 的系统判定必须问原生壳的同步接口（Android WebView 的 prefers-color-scheme
 *    在 Light 主题的 Activity 下不可靠），没有桥才退回 matchMedia；
 * 2. 显式 light / dark 优先于系统，系统深浅色变化不能覆盖用户的选择；
 * 3. 深色下强调色文字 / 描边往白混到可读，浅色下的混色结果与改动前逐位一致。
 *
 * 对比度在这里独立算一遍（不复用 theme.ts 的实现），否则实现算错了测试也会跟着错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  applyAccentIndex,
  applyMode,
  applySystemAppearance,
  applyTheme,
  effectiveMode,
  watchSystemMode,
} from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSettingsStore } from '@/stores/settings';

vi.mock('@/services/device-services', () => ({ device: { sync: vi.fn().mockResolvedValue({}) } }));

/** tokens.css 里深色模式的页面底色；jsdom 不加载样式表，applyTheme 走同一处的回退值。 */
const DARK_SCREEN = '#171a1f';
/** 与后端 THEME_COLORS 同序的 12 色色板（原生 AppSettings.ACCENTS 也是这一份）。 */
const PALETTE = [
  '#41707E',
  '#C05621',
  '#48515D',
  '#245D3C',
  '#2F6F8F',
  '#334E7D',
  '#0E6E62',
  '#6B3FA0',
  '#A32C5E',
  '#5F6B2A',
  '#A33B3B',
  '#8E4A76',
];

// ── 环境替身 ─────────────────────────────────────────────────────

interface MediaStub {
  matches: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: () => void;
  emit: () => void;
}

/** 伪造 matchMedia；返回的句柄可以改 matches 再手动触发 change。 */
function stubMatchMedia(matches: boolean): MediaStub {
  const listeners: (() => void)[] = [];
  const media: MediaStub = {
    matches,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: () => undefined,
    emit: () => listeners.forEach((listener) => listener()),
  };
  vi.stubGlobal('matchMedia', () => media);
  return media;
}

/** 装一个原生同步外观接口；传 null 表示没有原生桥。 */
function stubNativeAppearance(handler: (() => string) | null): void {
  const host = window as unknown as { CalMobileNative?: { systemAppearance(): string } };
  if (!handler) {
    delete host.CalMobileNative;
    return;
  }
  host.CalMobileNative = { systemAppearance: handler };
}

/** 旧壳：有动作入口，但没有同步外观接口。 */
function stubLegacyShell(): void {
  (window as unknown as { CalMobileNative?: unknown }).CalMobileNative = { invoke: () => undefined };
}

function appearanceJson(systemDark: boolean, mode = 'auto'): string {
  return JSON.stringify({ systemDark, mode });
}

function modeAttribute(): string | null {
  return document.documentElement.dataset.mode ?? null;
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

// ── 独立的 WCAG 对比度实现 ───────────────────────────────────────

function rgbChannels(hex: string): [number, number, number] {
  const text = hex.replace('#', '');
  const full =
    text.length === 3
      ? text
          .split('')
          .map((character) => character + character)
          .join('')
      : text;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const linear = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbChannels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

beforeEach(() => {
  setActivePinia(createPinia());
  // 每个用例从「没有首帧脚本写过东西」的干净 DOM 开始。
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('style');
  stubNativeAppearance(null);
  stubMatchMedia(false);
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, String(value)),
  });
  useBootstrapStore().apply({ theme: { colors: PALETTE, index: 0 } });
});

afterEach(() => vi.unstubAllGlobals());

// ── 系统深色的来源 ───────────────────────────────────────────────

describe('跟随系统的来源', () => {
  it('auto 时以原生同步接口为准，即使 WebView 的 matchMedia 说浅色', () => {
    stubMatchMedia(false);
    stubNativeAppearance(() => appearanceJson(true));
    applyMode('auto');
    // 根因回归：Android WebView 里 prefers-color-scheme 常常永远是浅色，
    // 所以 auto 不能听它，必须听原生读出来的 Configuration.uiMode。
    expect(useSettingsStore().mode).toBe('auto');
    expect(effectiveMode()).toBe('dark');
    expect(modeAttribute()).toBe('dark');
  });

  it('没有原生桥时退回 matchMedia（浏览器 / PWA）', () => {
    stubMatchMedia(true);
    applyMode('auto');
    expect(effectiveMode()).toBe('dark');
    expect(modeAttribute()).toBe('dark');
    stubMatchMedia(false);
    applyTheme();
    expect(modeAttribute()).toBe('light');
  });

  it('旧壳（有桥但没有同步外观接口）退回 matchMedia', () => {
    stubLegacyShell();
    stubMatchMedia(true);
    applyMode('auto');
    expect(modeAttribute()).toBe('dark');
  });

  it('auto 也显式写 data-mode，不再删属性留给 media query', () => {
    stubMatchMedia(false);
    applyMode('auto');
    expect(modeAttribute()).toBe('light');
    stubMatchMedia(true);
    applyTheme();
    expect(modeAttribute()).toBe('dark');
  });

  it('原生接口返回坏数据时退回 matchMedia，不静默当成浅色或抛错', () => {
    stubMatchMedia(true);
    stubNativeAppearance(() => 'not json');
    applyMode('auto');
    expect(modeAttribute()).toBe('dark');
  });

  it('原生接口同步抛错时退回 matchMedia', () => {
    stubMatchMedia(true);
    stubNativeAppearance(() => {
      throw new Error('bridge failure');
    });
    applyMode('auto');
    expect(modeAttribute()).toBe('dark');
  });
});

// ── 显式偏好的优先级 ─────────────────────────────────────────────

describe('显式明暗优先于系统', () => {
  it('浅色系统下选深色保持深色', () => {
    stubNativeAppearance(() => appearanceJson(false));
    applyMode('dark');
    expect(modeAttribute()).toBe('dark');
    applySystemAppearance({ systemDark: false, mode: 'auto' });
    expect(modeAttribute()).toBe('dark');
  });

  it('深色系统下选浅色保持浅色', () => {
    stubNativeAppearance(() => appearanceJson(true));
    applyMode('light');
    expect(modeAttribute()).toBe('light');
    applySystemAppearance({ systemDark: true, mode: 'auto' });
    expect(modeAttribute()).toBe('light');
  });

  it('auto 时跟随原生推来的系统外观（不重载、不弹回显式模式）', () => {
    stubMatchMedia(true);
    applyMode('auto');
    expect(modeAttribute()).toBe('dark');
    // 用户在系统设置里切回浅色：原生 onConfigurationChanged 推事件。
    applySystemAppearance(appearanceJson(false));
    expect(modeAttribute()).toBe('light');
    expect(useSettingsStore().mode).toBe('auto');
    // 再切回深色
    applySystemAppearance(appearanceJson(true));
    expect(modeAttribute()).toBe('dark');
  });

  it('坏事件数据被忽略，页面停在原来的明暗', () => {
    stubMatchMedia(false);
    applyMode('auto');
    for (const payload of ['not json', '{}', { systemDark: 'yes' }, null, []]) {
      applySystemAppearance(payload);
      expect(modeAttribute()).toBe('light');
    }
  });
});

// ── 浏览器 / PWA 的 matchMedia 监听 ──────────────────────────────

describe('浏览器里的系统深色监听', () => {
  it('auto 时 matchMedia 变化后跟随，显式模式不被覆盖', () => {
    const media = stubMatchMedia(false);
    applyMode('auto');
    watchSystemMode();
    media.matches = true;
    media.emit();
    expect(modeAttribute()).toBe('dark');

    applyMode('light');
    media.matches = false;
    media.emit();
    expect(modeAttribute()).toBe('light');
  });

  it('有原生同步接口时不重复监听 matchMedia（系统深浅色只走原生事件）', () => {
    const media = stubMatchMedia(false);
    stubNativeAppearance(() => appearanceJson(false));
    applyMode('auto');
    watchSystemMode();
    media.matches = true;
    media.emit();
    expect(modeAttribute()).toBe('light');
  });
});

// ── 深色下的强调色 ───────────────────────────────────────────────

describe('深色下的强调色可读性', () => {
  beforeEach(() => {
    stubNativeAppearance(() => appearanceJson(true));
  });

  it('每个色板的强调色文字都往白混到 ≥4.5:1，且比原色更亮', () => {
    for (let index = 0; index < PALETTE.length; index += 1) {
      applyAccentIndex(index);
      const accent = cssVar('--accent');
      const ink = cssVar('--accent-ink');
      expect(accent).toBe(PALETTE[index]);
      expect(contrast(ink, DARK_SCREEN)).toBeGreaterThanOrEqual(4.5);
      // 混色方向：深色底上必须往白混；往页面底色混会越混越暗（改动前的 bug）。
      expect(luminance(ink)).toBeGreaterThan(luminance(accent));
    }
  });

  it('强调色描边在深色底上 ≥3:1，且比原色更亮', () => {
    for (let index = 0; index < PALETTE.length; index += 1) {
      applyAccentIndex(index);
      const accent = cssVar('--accent');
      const edge = cssVar('--accent-edge');
      expect(contrast(edge, DARK_SCREEN)).toBeGreaterThanOrEqual(3);
      expect(luminance(edge)).toBeGreaterThan(luminance(accent));
    }
  });

  it('悬浮底色压暗强调色，白字仍然 ≥4.5:1', () => {
    for (let index = 0; index < PALETTE.length; index += 1) {
      applyAccentIndex(index);
      const hover = cssVar('--accent-hover');
      expect(contrast('#ffffff', hover)).toBeGreaterThanOrEqual(4.5);
      expect(luminance(hover)).toBeLessThan(luminance(cssVar('--accent')));
    }
  });

  it('管理端下发的浅色强调色不会被往白混出低对比度', () => {
    // 自定义首色可以是任意 #RRGGBB：浅色强调色在深色底上本来就够亮，不应再往白混。
    useBootstrapStore().apply({ theme: { colors: ['#FFE08A'], index: 0 } });
    applyAccentIndex(0);
    expect(contrast(cssVar('--accent-ink'), DARK_SCREEN)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cssVar('--accent-edge'), DARK_SCREEN)).toBeGreaterThanOrEqual(3);
  });
});

// ── 浅色视觉不变 ─────────────────────────────────────────────────

describe('浅色模式视觉不变', () => {
  it('沿用改动前的混色结果（强调色往黑 28% / 往白底 60%）', () => {
    stubNativeAppearance(() => appearanceJson(false));
    applyAccentIndex(0);
    expect(modeAttribute()).toBe('light');
    // 默认强调色 #41707E：这三个值就是改动前 applyTheme 算出来的结果。
    expect(cssVar('--accent-ink')).toBe('#2f515b');
    expect(cssVar('--accent-edge')).toBe('#b3c6cb');
    // 悬浮底色与旧的 --accent-ink 同值：深色以外的地方手感不变。
    expect(cssVar('--accent-hover')).toBe('#2f515b');
  });

  it('渲染结果与明暗模式无关的 --accent-tint 仍取页面底色', () => {
    stubNativeAppearance(() => appearanceJson(true));
    applyTheme('dark');
    expect(cssVar('--accent-tint')).toBe(DARK_SCREEN);
    applyTheme('light');
    expect(cssVar('--accent-tint')).toBe('#ffffff');
  });
});
