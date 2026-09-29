/**
 * 外观：深色模式与管理员配色。
 *
 * 页面与组件只写 `--accent*` 令牌，因此配色与明暗都在这里落一次 CSS 变量：
 * - 明暗模式写到 `<html data-mode>`，由 tokens.css 的一组令牌接管颜色；
 *   偏好同时缓存在本机，`index.html` 的内联脚本让首帧就落到正确模式（不闪白）。
 * - 强调色由后端下发（`theme.colors` + `theme.index`），浅底与描边用强调色与
 *   「当前页面底色」混出，深色模式下自动变成深底；运行时不写死颜色。
 */
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';

const MODE_KEY = 'calmobile.mode';
const ACCENT_KEY = 'calmobile.accent';

export type UiMode = 'auto' | 'light' | 'dark';

/** 上次选择的明暗模式，供 `index.html` 首帧使用。 */
export function readStoredMode(): UiMode | '' {
  try {
    const value = window.localStorage?.getItem(MODE_KEY);
    return value === 'light' || value === 'dark' ? value : '';
  } catch {
    // 隐私模式下读不到就跟随系统
    return '';
  }
}

/** 上次选择的强调色，供 `index.html` 首帧使用（避免首帧橙色再跳到用户选择）。 */
export function readStoredAccent(): string {
  try {
    return window.localStorage?.getItem(ACCENT_KEY) || '';
  } catch {
    return '';
  }
}

/** 应用配色色板（后端补齐后的 8 色）。 */
export function palette(): string[] {
  const colors = useBootstrapStore().theme.colors;
  return Array.isArray(colors) ? colors.map((item) => String(item)) : [];
}

/**
 * 切换强调色：只改本地（令牌 + 本机缓存），落库由 `app/preferences.ts` 负责。
 * 这样 `applyTheme` 既能被「换色」调用，也能被「跟随系统明暗变化」调用而不触发请求。
 */
export function applyAccentIndex(index: number): number {
  const colors = palette();
  const max = Math.max(0, colors.length - 1);
  const next = Math.min(Math.max(0, Math.trunc(Number(index) || 0)), max);
  const bootstrap = useBootstrapStore();
  bootstrap.theme = { ...bootstrap.theme, index: next };
  try {
    window.localStorage?.setItem(ACCENT_KEY, colors[next] || '');
  } catch {
    // 隐私模式下忽略缓存失败，本次会话内仍然生效
  }
  applyTheme();
  return next;
}

/** 当前实际生效的明暗模式（`auto` 看系统偏好）。 */
export function effectiveMode(): 'light' | 'dark' {
  const mode = useSettingsStore().mode;
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/** 切换明暗模式：写令牌、缓存到本机，并把外观镜像给原生。 */
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
    // 隐私模式下忽略缓存失败，本次会话内仍然生效
  }
  // 浅底与描边要与页面底色混色，底色变了必须重算。
  applyTheme();
  void syncDevice();
  return next;
}

/** 管理员配色写入 CSS 变量。 */
export function applyTheme(): void {
  const bootstrap = useBootstrapStore();
  const colors = Array.isArray(bootstrap.theme.colors) ? bootstrap.theme.colors : [];
  const index = Number(bootstrap.theme.index) || 0;
  const accent = String(colors[index] || '#c05621');
  const root = document.documentElement;
  const mode = effectiveMode();
  const screen = cssColor('--screen', mode === 'dark' ? '#171a1f' : '#ffffff');
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-ink', mode === 'dark' ? mix(accent, screen, 0.28) : mix(accent, '#000000', 0.28));
  // 次按钮底色与页面底色一致，只让边框和文字跟随强调色。
  root.style.setProperty('--accent-tint', screen);
  root.style.setProperty('--accent-edge', mix(accent, screen, mode === 'dark' ? 0.62 : 0.6));
  root.style.setProperty('--accent-glow', rgba(accent, mode === 'dark' ? 0.26 : 0.14));
  root.style.setProperty('--accent-shadow', rgba(accent, mode === 'dark' ? 0.34 : 0.2));
  root.dataset.accent = String(index);
}

/**
 * 把只有设备侧才用得上的一部分状态镜像给原生：状态栏配色、图片压缩与格式上限。
 * 返回值带回系统通知权限，那是设备事实，后端无从得知。
 */
export async function syncDevice(): Promise<void> {
  const settings = useSettingsStore();
  const bootstrap = useBootstrapStore();
  try {
    const result = await device.sync({
      mode: settings.mode,
      themeIndex: Number(bootstrap.theme.index) || 0,
      media: bootstrap.media,
      upload: bootstrap.server,
    }) as { notificationsGranted?: boolean } | null | undefined;
    if (result && typeof result.notificationsGranted === 'boolean') {
      useCapabilitiesStore().apply({ notifications: result.notificationsGranted });
    }
  } catch {
    // 镜像同步失败只影响原生外观，页面继续用后端下发的值。
  }
}

/** 跟随系统时，系统切换深浅色要重新混一遍强调色的衍生值。 */
export function watchSystemMode(): void {
  if (typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if (useSettingsStore().mode === 'auto') applyTheme();
  });
}

function cssColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

/** 与另一种颜色按比例混合，`ratio` 是后者的占比。 */
function mix(color: string, other: string, ratio: number): string {
  const a = hex(color);
  const b = hex(other);
  const channel = (index: number) => Math.round((a[index] ?? 0) * (1 - ratio) + (b[index] ?? 0) * ratio);
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(color: string, alpha: number): string {
  const [r = 192, g = 86, b = 33] = hex(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hex(color: string): [number, number, number] {
  const text = String(color || '').replace('#', '');
  const full = text.length === 3 ? text.split('').map((character) => character + character).join('') : text;
  const value = Number.parseInt(full.slice(0, 6) || 'c05621', 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
