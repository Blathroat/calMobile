/**
 * 外观：深色模式与管理员配色。
 *
 * 页面与组件只写 `--accent*` 令牌，因此配色与明暗都在这里落一次 CSS 变量：
 * - 明暗模式写到 `<html data-mode>`，**始终有值**（auto 时写解析后的 light / dark），
 *   由 tokens.css 的一组令牌接管颜色；偏好同时缓存在本机，`index.html` 的内联脚本
 *   让首帧就落到正确模式（不闪白）。
 * - 系统深浅色只有原生读得准（Android WebView 的 `prefers-color-scheme` 不可靠）：
 *   原生壳用同步接口 `systemAppearance()` 回答首帧，配置变化时再推
 *   `window.CalMobileWeb.appearance()`；浏览器 / PWA 用 matchMedia。
 * - 强调色由后端下发（`theme.colors` + `theme.index`）。浅底沿用「往黑混」；深色底
 *   往**白**混到可读（往页面底色混只会越混越暗），描边同样只混到刚好可辨识。
 */
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSettingsStore } from '@/stores/settings';
import { device } from '@/services/device-services';

const MODE_KEY = 'calmobile.mode';
const ACCENT_KEY = 'calmobile.accent';

export type UiMode = 'auto' | 'light' | 'dark';

/** 深色底上强调色文字的最低对比度：正文 ≥4.5:1。 */
const ACCENT_INK_MIN_CONTRAST = 4.5;
/** 深色底上强调色描边的最低对比度：非文字界面元素 ≥3:1。 */
const ACCENT_EDGE_MIN_CONTRAST = 3;

/** 原生同步外观通道（`WebAppBridge.systemAppearance`）：直接返回 JSON，不走动作表与回调。 */
interface NativeAppearanceHost {
  systemAppearance(): string;
}

/** 原生注入给页面的回调出口：外观事件，以及旧壳约定的 `ready()`。 */
interface CalMobileWebHost {
  appearance?: (info: unknown) => void;
  ready?: () => void;
}

/** 原生回答的系统外观；`systemDark` 来自 `Configuration.uiMode`。 */
interface SystemAppearance {
  systemDark: boolean;
  mode: UiMode;
}

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
  return systemDark() ? 'dark' : 'light';
}

/** 原生同步外观入口；没有壳或旧壳没有这个方法时返回 undefined，页面一律退回浏览器语义。 */
function nativeAppearanceHost(): NativeAppearanceHost | undefined {
  if (typeof window === 'undefined') return undefined;
  // `CalMobileNative` 的动作表类型只声明了 invoke / report；同步外观方法是单独声明的只读入口，
  // 不为它扩动作表（它没有回调、也不进 `app.capabilities`）。旧壳没有这个方法，类型判断后走 matchMedia。
  const host = window.CalMobileNative as unknown as Partial<NativeAppearanceHost> | undefined;
  return host && typeof host.systemAppearance === 'function' ? (host as NativeAppearanceHost) : undefined;
}

/**
 * 系统是不是深色（只给 auto 用）。
 *
 * 有原生壳时问同步接口：Android WebView 的 `prefers-color-scheme` 在 Light 主题的 Activity 下
 * 不可靠（系统切深色页面也不会变），系统深浅色只能由原生读 `Configuration.uiMode`。
 * 浏览器 / PWA / 旧壳退回 matchMedia，行为与以前一致。
 */
function systemDark(): boolean {
  const host = nativeAppearanceHost();
  if (host) {
    try {
      const parsed = parseSystemAppearance(host.systemAppearance());
      if (parsed) return parsed.systemDark;
    } catch {
      // 桥调用失败不能让外观整个停摆：退回 matchMedia 的浏览器语义。
    }
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 解析原生回的外观 JSON（字符串；测试里也可能是已解析对象）。坏数据给 null，不静默当成浅色。 */
function parseSystemAppearance(input: unknown): SystemAppearance | null {
  let value: unknown = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { systemDark?: unknown; mode?: unknown };
  if (typeof record.systemDark !== 'boolean') return null;
  const mode = record.mode;
  return { systemDark: record.systemDark, mode: mode === 'light' || mode === 'dark' ? mode : 'auto' };
}

/** 切换明暗模式：写令牌、缓存到本机，并把外观镜像给原生。 */
export function applyMode(mode: string): UiMode {
  const next: UiMode = mode === 'light' || mode === 'dark' ? mode : 'auto';
  useSettingsStore().setMode(next);
  try {
    window.localStorage?.setItem(MODE_KEY, next);
  } catch {
    // 隐私模式下忽略缓存失败，本次会话内仍然生效
  }
  // applyTheme 会把实际明暗写进 data-mode（auto 也写，不再删属性），并重算强调色衍生值。
  applyTheme();
  void syncDevice();
  return next;
}

/** 当前实际生效的强调色：色板当前下标，缺色时退回首色。 */
export function currentAccentColor(): string {
  const colors = palette();
  const index = Number(useBootstrapStore().theme.index) || 0;
  return colors[index] || colors[0] || '#41707E';
}

/**
 * 管理员配色写入 CSS 变量，并把实际明暗写到 `<html data-mode>`。
 *
 * @param resolved 调用方已经确定的明暗（原生推来系统外观时用它，避免再问一次桥）；
 *   缺省按当前偏好解析（auto 看系统）。
 */
export function applyTheme(resolved?: 'light' | 'dark'): void {
  const bootstrap = useBootstrapStore();
  const index = Number(bootstrap.theme.index) || 0;
  const accent = currentAccentColor();
  const root = document.documentElement;
  const mode = resolved ?? effectiveMode();
  // 先落 data-mode 再读 --screen：两者必须来自同一次明暗判定，否则会拿浅色底算深色混色。
  root.dataset.mode = mode;
  const screen = cssColor('--screen', mode === 'dark' ? '#171a1f' : '#ffffff');
  root.style.setProperty('--accent', accent);
  // 深色底上强调色文字往白混，直到在页面底色上可读（往底色混只会越混越暗）；
  // 浅色底继续往黑混，视觉与以前完全一致。
  root.style.setProperty(
    '--accent-ink',
    mode === 'dark'
      ? mixUntilContrast(accent, '#ffffff', screen, ACCENT_INK_MIN_CONTRAST, 0)
      : mix(accent, '#000000', 0.28),
  );
  // 次按钮底色与页面底色一致，只让边框和文字跟随强调色。
  root.style.setProperty('--accent-tint', screen);
  // 次按钮描边只有 1.5px，深色下也要能看见：至少 3:1（非文字界面元素的下限）。
  root.style.setProperty(
    '--accent-edge',
    mode === 'dark'
      ? mixUntilContrast(accent, '#ffffff', screen, ACCENT_EDGE_MIN_CONTRAST, 0.12)
      : mix(accent, screen, 0.6),
  );
  // 悬浮底色：浅色沿用原来的「强调色往黑混」；深色下 --accent-ink 已经往白混，
  // 不能再拿它当悬浮底（白字会压在浅色上），改成把强调色压暗一档，白字仍 ≥4.5:1。
  root.style.setProperty(
    '--accent-hover',
    mode === 'dark' ? mix(accent, '#000000', 0.2) : mix(accent, '#000000', 0.28),
  );
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
    const result = (await device.sync({
      mode: settings.mode,
      themeIndex: Number(bootstrap.theme.index) || 0,
      // 管理端下发的首色可能覆盖色板 0；系统栏要用页面当前实际生效的这一色。
      accentColor: currentAccentColor(),
      media: bootstrap.media,
      upload: bootstrap.server,
    })) as { notificationsGranted?: boolean } | null | undefined;
    if (result && typeof result.notificationsGranted === 'boolean') {
      useCapabilitiesStore().apply({ notifications: result.notificationsGranted });
    }
  } catch {
    // 镜像同步失败只影响原生外观，页面继续用后端下发的值。
  }
}

/**
 * 跟随系统：浏览器 / PWA（以及没有同步外观接口的旧壳）监听 matchMedia。
 *
 * 新壳在 `onConfigurationChanged` 里推外观事件（`applySystemAppearance`），系统深浅色
 * 只走那一条路径，这里不重复监听——同一个事件两条路径都会重写 data-mode，容易互相覆盖。
 */
export function watchSystemMode(): void {
  if (nativeAppearanceHost()) return;
  if (typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if (useSettingsStore().mode === 'auto') applyTheme();
  });
}

/**
 * 原生推来的系统外观（`WebShellActivity.onConfigurationChanged`）。
 *
 * 只在账号 mode 为 `auto` 时跟随：显式 light / dark 由用户决定，系统切换不能覆盖它。
 * 只重写 data-mode 与强调色衍生值，**不重载页面**；原生镜像的 `mode` 不作为权威
 * （账号偏好才是），这里只认 `systemDark`。
 */
export function applySystemAppearance(info: unknown): void {
  const parsed = parseSystemAppearance(info);
  if (!parsed) return;
  if (useSettingsStore().mode !== 'auto') return;
  const target = parsed.systemDark ? 'dark' : 'light';
  // 系统深浅色没变（例如只是旋转屏幕）就不必重算，避免多余的样式写入与过渡。
  if (document.documentElement.dataset.mode === target) return;
  applyTheme(target);
}

/** 装上原生→页面的外观事件入口；模块加载时装一次，原生在配置变化后直接调它。 */
function installAppearanceHook(): void {
  if (typeof window === 'undefined') return;
  const host = ((window as Window & { CalMobileWeb?: CalMobileWebHost }).CalMobileWeb ??= {});
  host.appearance = (info: unknown) => applySystemAppearance(info);
}

installAppearanceHook();

function cssColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

/**
 * 把 `color` 往 `toward` 混，直到与 `against` 的对比度达到 `target`。
 *
 * 深色主题下强调色系（文字 / 描边）只能这样做：把强调色和页面底色混，结果是越来越接近底色，
 * 对比度反而下降。`start` 是起始混色比例（描边给一点下限，避免与强调色完全相同）。
 */
function mixUntilContrast(color: string, toward: string, against: string, target: number, start: number): string {
  for (let percent = Math.round(start * 100); percent <= 100; percent += 1) {
    const candidate = mix(color, toward, percent / 100);
    if (contrast(candidate, against) >= target) return candidate;
  }
  return mix(color, toward, 1);
}

/** WCAG 相对亮度。 */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = hex(color);
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（1:1 ~ 21:1）。 */
function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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
  const full =
    text.length === 3
      ? text
          .split('')
          .map((character) => character + character)
          .join('')
      : text;
  const value = Number.parseInt(full.slice(0, 6) || 'c05621', 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
