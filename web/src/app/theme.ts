/**
 * 外观：明暗模式与官方 Radix UI Colors v3 12 级色阶映射。
 *
 * 所有组件统一读取语义令牌（遵循 Radix UI Colors 规范）：
 * - Step 1–2：背景底面（--accent-tint = Step 2）
 * - Step 3–5：控件背景（normal = 3, hover = 4, active = 5）
 * - Step 6：非交互细分隔边框（--accent-edge = Step 6）
 * - Step 7–8：交互控件边框与焦点环（--accent-border = 7, --accent-ring = 8）
 * - Step 9–10：实心主色填充与悬停（--accent-solid = 9, --accent-solid-hover = 10）
 * - Step 11：低对比度强调文字与图标（--accent-ink = 11）
 * - Step 12：高对比度强调文字（--accent-ink-hi = 12）
 */
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';

const MODE_KEY = 'calmobile.mode';
const ACCENT_KEY = 'calmobile.accent';

export type UiMode = 'auto' | 'light' | 'dark';

interface RadixScale {
  anchor: string;
  light: readonly [string, string, string, string, string, string, string, string, string, string, string];
  dark: readonly [string, string, string, string, string, string, string, string, string, string, string];
}

/**
 * 官方 Radix UI Colors v3 色阶（Steps 2..12），按服务端 12 色色板槽位一一对应：
 * 0 Cyan, 1 Orange, 2 Slate, 3 Grass, 4 Blue, 5 Indigo,
 * 6 Teal, 7 Violet, 8 Crimson, 9 Jade, 10 Ruby, 11 Plum
 */
const RADIX_SCALES: readonly RadixScale[] = [
  {
    anchor: '#41707E', // Cyan
    light: [
      '#f2fafb',
      '#def7f9',
      '#caf1f6',
      '#b5e9f0',
      '#9ddde7',
      '#7dcedc',
      '#3db9cf',
      '#00a2c7',
      '#0797b9',
      '#107d98',
      '#0d3c48',
    ],
    dark: [
      '#101b20',
      '#082c36',
      '#003848',
      '#004558',
      '#045468',
      '#12677e',
      '#11809c',
      '#00a2c7',
      '#23afcf',
      '#4ccce6',
      '#b6ecf7',
    ],
  },
  {
    anchor: '#C05621', // Orange
    light: [
      '#fef8f4',
      '#ffedd5',
      '#ffdfb5',
      '#ffd19a',
      '#ffc182',
      '#f5ae73',
      '#ec9455',
      '#f76b15',
      '#ef5f00',
      '#cc4e00',
      '#582d1d',
    ],
    dark: [
      '#201511',
      '#331e0b',
      '#462100',
      '#562800',
      '#66350c',
      '#7e451d',
      '#a35829',
      '#f76b15',
      '#ff801f',
      '#ffa057',
      '#ffe0c2',
    ],
  },
  {
    anchor: '#48515D', // Slate (high-contrast neutral solid at 9/10 for legible white button text)
    light: [
      '#f9f9fb',
      '#f0f0f3',
      '#e8e8ec',
      '#e0e1e6',
      '#d9d9e0',
      '#cdced6',
      '#b9bbc6',
      '#60646c',
      '#52565e',
      '#60646c',
      '#1c2024',
    ],
    dark: [
      '#18191b',
      '#212225',
      '#272a2d',
      '#2e3135',
      '#363a3f',
      '#43484e',
      '#5a6169',
      '#696e77',
      '#777b84',
      '#b0b4ba',
      '#edeef0',
    ],
  },
  {
    anchor: '#245D3C', // Grass
    light: [
      '#f5fbf5',
      '#e9f6e9',
      '#daf1db',
      '#c9e8ca',
      '#b2ddb5',
      '#94ce9a',
      '#65ba74',
      '#46a758',
      '#3e9b4f',
      '#2a7e3b',
      '#203c25',
    ],
    dark: [
      '#141a15',
      '#1b2a1e',
      '#1d3a24',
      '#25482d',
      '#2d5736',
      '#366740',
      '#3e7949',
      '#46a758',
      '#53b365',
      '#71d083',
      '#c2f0c2',
    ],
  },
  {
    anchor: '#2F6F8F', // Blue
    light: [
      '#f4faff',
      '#e6f4fe',
      '#d5efff',
      '#c2e5ff',
      '#acd8fc',
      '#8ec8f6',
      '#5eb1ef',
      '#0090ff',
      '#0588f0',
      '#0d74ce',
      '#113264',
    ],
    dark: [
      '#111927',
      '#0d2847',
      '#003362',
      '#004074',
      '#104d87',
      '#205d9e',
      '#2870bd',
      '#0090ff',
      '#3b9eff',
      '#70b8ff',
      '#c2e6ff',
    ],
  },
  {
    anchor: '#334E7D', // Indigo
    light: [
      '#f7f9ff',
      '#edf2fe',
      '#e1e9ff',
      '#d2deff',
      '#c1d0ff',
      '#abbdf9',
      '#8da4ef',
      '#3e63dd',
      '#3358d4',
      '#3a5bc7',
      '#1f2d5c',
    ],
    dark: [
      '#141726',
      '#182449',
      '#1d2e62',
      '#253974',
      '#304384',
      '#3a4f97',
      '#435db1',
      '#3e63dd',
      '#5472e4',
      '#9eb1ff',
      '#d6e1ff',
    ],
  },
  {
    anchor: '#0E6E62', // Teal
    light: [
      '#f3fbf9',
      '#e0f8f3',
      '#ccf3ea',
      '#b8eae0',
      '#a1ded2',
      '#83cdc1',
      '#53b9ab',
      '#12a594',
      '#0d9b8a',
      '#008573',
      '#0d3d38',
    ],
    dark: [
      '#111c1b',
      '#0d2d2a',
      '#023b37',
      '#084843',
      '#145750',
      '#1c6961',
      '#207e73',
      '#12a594',
      '#0eb39e',
      '#0bd8b6',
      '#adf0dd',
    ],
  },
  {
    anchor: '#6B3FA0', // Violet
    light: [
      '#faf8ff',
      '#f4f0fe',
      '#ebe4ff',
      '#e1d9ff',
      '#d4cafe',
      '#c2b5f5',
      '#aa99ec',
      '#6e56cf',
      '#654dc4',
      '#6550b9',
      '#2f265f',
    ],
    dark: [
      '#191523',
      '#251e40',
      '#2c2250',
      '#362c63',
      '#413576',
      '#4f418d',
      '#6452b4',
      '#6e56cf',
      '#7d66d9',
      '#baa7ff',
      '#e2ddfe',
    ],
  },
  {
    anchor: '#A32C5E', // Crimson
    light: [
      '#fef7f9',
      '#fdecef',
      '#fce0e6',
      '#f9d2dc',
      '#f3c2cf',
      '#eaacc0',
      '#e093b2',
      '#e93d82',
      '#df3478',
      '#cb1d63',
      '#621639',
    ],
    dark: [
      '#201318',
      '#381525',
      '#4d122f',
      '#5c1839',
      '#6d2545',
      '#873356',
      '#b0436e',
      '#e93d82',
      '#ee518a',
      '#ff92ad',
      '#fdd3e8',
    ],
  },
  {
    anchor: '#5F6B2A', // Jade
    light: [
      '#f4fbf7',
      '#e6f7ed',
      '#d6f1e3',
      '#c3e9d7',
      '#acdec8',
      '#8bceb6',
      '#56ba9f',
      '#29a383',
      '#26997b',
      '#208368',
      '#1d3b31',
    ],
    dark: [
      '#121c18',
      '#0f2e22',
      '#0b3b2c',
      '#114837',
      '#1b5745',
      '#246854',
      '#2a7e68',
      '#29a383',
      '#27b08b',
      '#1fd8a4',
      '#adf0d4',
    ],
  },
  {
    anchor: '#A33B3B', // Ruby
    light: [
      '#fff7f8',
      '#feeaed',
      '#ffdce1',
      '#ffced6',
      '#f8bfc8',
      '#efacb8',
      '#e592a3',
      '#e54666',
      '#dc3b5d',
      '#ca244d',
      '#64172b',
    ],
    dark: [
      '#1e1517',
      '#3a141e',
      '#4e1325',
      '#5e1a2e',
      '#6f2539',
      '#883447',
      '#b3445a',
      '#e54666',
      '#ec5a72',
      '#ff949d',
      '#fed2e1',
    ],
  },
  {
    anchor: '#8E4A76', // Plum
    light: [
      '#fef7fe',
      '#fbebfb',
      '#f7def8',
      '#f2d1f3',
      '#e9c2ec',
      '#deade3',
      '#cf91d8',
      '#ab4aba',
      '#a144af',
      '#953ea3',
      '#53195d',
    ],
    dark: [
      '#1d1520',
      '#351a35',
      '#451d47',
      '#512454',
      '#5e3061',
      '#734079',
      '#92549c',
      '#ab4aba',
      '#b658c4',
      '#e796f3',
      '#f4d4f4',
    ],
  },
];

function resolveRadixScale(color: string, slotIndex: number): RadixScale {
  const upper = String(color || '')
    .trim()
    .toUpperCase();
  const byAnchor = RADIX_SCALES.find((scale) => scale.anchor === upper);
  if (byAnchor) return byAnchor;
  if (slotIndex > 0 && slotIndex < RADIX_SCALES.length) {
    const slotted = RADIX_SCALES[slotIndex];
    if (slotted && upper === slotted.anchor) return slotted;
  }
  // 自定义管理端首色调：在官方 12 套 Radix 色阶中找色相/感知距离最近的一套
  const [r, g, b] = hex(color);
  let best = RADIX_SCALES[0]!;
  let minDist = Number.POSITIVE_INFINITY;
  for (const scale of RADIX_SCALES) {
    const [sr, sg, sb] = hex(scale.light[7]); // Step 9 solid
    const dist = (r - sr) * (r - sr) * 0.3 + (g - sg) * (g - sg) * 0.59 + (b - sb) * (b - sb) * 0.11;
    if (dist < minDist) {
      minDist = dist;
      best = scale;
    }
  }
  return best;
}

/** 供设置页色块展示对应的官方 Radix Step 9 实心色。 */
export function radixSwatchColor(color: string, index: number): string {
  const scale = resolveRadixScale(color, index);
  const mode = effectiveMode();
  return mode === 'dark' ? scale.dark[7] : scale.light[7];
}

export function readStoredMode(): UiMode | '' {
  try {
    const value = window.localStorage?.getItem(MODE_KEY);
    return value === 'light' || value === 'dark' ? value : '';
  } catch {
    return '';
  }
}

export function readStoredAccent(): string {
  try {
    return window.localStorage?.getItem(ACCENT_KEY) || '';
  } catch {
    return '';
  }
}

export function palette(): string[] {
  const colors = useBootstrapStore().theme.colors;
  return Array.isArray(colors) ? colors.map((item) => String(item)) : [];
}

export function applyAccentIndex(index: number): number {
  const colors = palette();
  const max = Math.max(0, colors.length - 1);
  const next = Math.min(Math.max(0, Math.trunc(Number(index) || 0)), max);
  const bootstrap = useBootstrapStore();
  bootstrap.theme = { ...bootstrap.theme, index: next };
  try {
    window.localStorage?.setItem(ACCENT_KEY, colors[next] || '');
  } catch {
    // 隐私模式下忽略缓存失败
  }
  applyTheme();
  return next;
}

export function effectiveMode(): 'light' | 'dark' {
  const mode = useSettingsStore().mode;
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyMode(mode: string): UiMode {
  const next: UiMode = mode === 'light' || mode === 'dark' ? mode : 'auto';
  useSettingsStore().setMode(next);
  if (next === 'auto') {
    delete document.documentElement.dataset.mode;
  } else {
    document.documentElement.dataset.mode = next;
  }
  try {
    window.localStorage?.setItem(MODE_KEY, next);
  } catch {
    // 隐私模式下忽略缓存失败
  }
  applyTheme();
  void syncDevice();
  return next;
}

export function currentAccentColor(): string {
  const colors = palette();
  const index = Number(useBootstrapStore().theme.index) || 0;
  return colors[index] || colors[0] || '#41707E';
}

/** 将官方 Radix UI Colors 12 级色阶写入全局 CSS 变量。 */
export function applyTheme(): void {
  const bootstrap = useBootstrapStore();
  const index = Number(bootstrap.theme.index) || 0;
  const accent = currentAccentColor();
  const root = document.documentElement;
  const mode = effectiveMode();
  const scale = resolveRadixScale(accent, index);
  const steps = mode === 'dark' ? scale.dark : scale.light;

  // 保留原始 --accent 以兼容偏好缓存与测试契约，视觉令牌全部取自 Radix Steps 2..12
  root.style.setProperty('--accent', accent);
  for (let i = 0; i < steps.length; i += 1) {
    root.style.setProperty(`--accent-${i + 2}`, steps[i]!);
  }
  root.style.setProperty('--accent-tint', steps[0]); // Step 2: Subtle background
  root.style.setProperty('--accent-soft', steps[1]); // Step 3: UI element background
  root.style.setProperty('--accent-soft-hover', steps[2]); // Step 4: Hovered UI background
  root.style.setProperty('--accent-soft-active', steps[3]); // Step 5: Active UI background
  root.style.setProperty('--accent-edge', steps[4]); // Step 6: Subtle border
  root.style.setProperty('--accent-border', steps[5]); // Step 7: Interactive border
  root.style.setProperty('--accent-ring', steps[6]); // Step 8: Focus ring / hover border
  root.style.setProperty('--accent-solid', steps[7]); // Step 9: Solid fill
  root.style.setProperty('--accent-solid-hover', steps[8]); // Step 10: Hovered solid fill
  root.style.setProperty('--accent-ink', steps[9]); // Step 11: Low-contrast accent text
  root.style.setProperty('--accent-ink-hi', steps[10]); // Step 12: High-contrast accent text
  root.dataset.accent = String(index);
}

export async function syncDevice(): Promise<void> {
  const settings = useSettingsStore();
  const bootstrap = useBootstrapStore();
  try {
    const result = (await device.sync({
      mode: settings.mode,
      themeIndex: Number(bootstrap.theme.index) || 0,
      accentColor: currentAccentColor(),
      media: bootstrap.media,
      upload: bootstrap.server,
    })) as { notificationsGranted?: boolean } | null | undefined;
    if (result && typeof result.notificationsGranted === 'boolean') {
      useCapabilitiesStore().apply({ notifications: result.notificationsGranted });
    }
  } catch {
    // 忽略原生状态栏同步失败
  }
}

export function watchSystemMode(): void {
  if (typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if (useSettingsStore().mode === 'auto') applyTheme();
  });
}

function hex(color: string): [number, number, number] {
  const text = String(color || '').replace('#', '');
  const full =
    text.length === 3
      ? text
          .split('')
          .map((character) => character + character)
          .join('')
      : text;
  const value = Number.parseInt(full.slice(0, 6) || '00a2c7', 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
