import { createApi } from '@/api/client';
import type { Bootstrap } from '@/api/types';
import { applyAccentIndex, applyMode } from '@/app/theme';
import { isJoinSurface } from '@/app/surface';
import {
  applyOfferedLang,
  currentLanguageId,
  downloadMissingPacks,
  reloadForLanguage,
  t,
  type LangOffer,
} from '@/i18n';
import { toast } from '@/services/toast';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useCapabilitiesStore } from '@/stores/capabilities';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';

export const api = createApi(undefined, () => useSessionStore().expire());

let bootPromise: Promise<void> | undefined;

export function bootApp(): Promise<void> {
  if (bootPromise) return bootPromise;
  applyDocumentTitle();
  applyBrandingMeta();
  bootPromise = api.session
    // 先从设备存储恢复会话（有刷新令牌就换一张访问令牌），再取启动数据：
    // 顺序反了的话 bootstrap 会以匿名身份回答，页面首帧会停在登录页。
    .restore()
    .catch(() => false)
    .then(() => refreshRuntimeBootstrap())
    .catch((error) => {
      bootPromise = undefined;
      throw error;
    });
  return bootPromise;
}

export function resetBootForTests(): void {
  bootPromise = undefined;
}

/**
 * 页面标题（浏览器页签、分享预览）。HTML 里由服务端写入实例标题，品牌名由启动数据补齐：
 * 应用页用「品牌 · 应用名」，报名站用 `JOIN_TITLE`；服务端注入的
 * `window.__CALMOBILE_BRANDING__` 负责首帧，`bootstrap.branding` 负责启动后确认。
 *
 * `APP_TITLE` 是完整标题覆盖，设置后不再拼品牌前缀；`PWA_APP_NAME` 是应用名。
 * 切语言会整页重载，所以不用监听。
 */
export function applyDocumentTitle(): void {
  if (typeof document === 'undefined') return;
  if (isJoinSurface) {
    document.title = brandingText('joinTitle') || t('join.documentTitle');
    return;
  }
  const brand = String(useBootstrapStore().brand.zh || '').trim();
  const title = brandingText('appTitle');
  if (title) {
    document.title = title;
    return;
  }
  const appName = brandingText('appName') || pwaAppName();
  document.title = brand ? `${brand} · ${appName}` : appName;
}

/** 用运行时品牌补齐 `meta description`、Apple 主屏幕标题与明暗主题色。 */
export function applyBrandingMeta(): void {
  if (typeof document === 'undefined') return;
  const description = brandingText('description');
  if (description) setMetaContent('description', description);
  const shortName = brandingText('shortName');
  if (shortName) setMetaContent('apple-mobile-web-app-title', shortName);
  const themeColor = brandingText('themeColor');
  if (themeColor) setThemeColorMeta('light', themeColor);
  const themeColorDark = brandingText('themeColorDark');
  if (themeColorDark) setThemeColorMeta('dark', themeColorDark);
}

function setMetaContent(name: string, value: string): void {
  const meta = document.querySelector(`meta[name="${name}"]`);
  if (meta) meta.setAttribute('content', value);
}

function setThemeColorMeta(scheme: 'light' | 'dark', value: string): void {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') || '';
    const dark = media.includes('dark');
    if ((scheme === 'dark') === dark) meta.setAttribute('content', value);
  }
}

type BrandingKey =
  | 'appName'
  | 'shortName'
  | 'description'
  | 'appTitle'
  | 'joinTitle'
  | 'lang'
  | 'themeColor'
  | 'themeColorDark'
  | 'backgroundColor';

/**
 * 品牌字段优先级：`bootstrap`（服务端运行配置）→ 首帧注入的全局 → 空串。
 * 空串表示让构建期静态标题/manifest 继续生效。
 */
function brandingText(key: BrandingKey): string {
  const store = useBootstrapStore();
  const stored = store.branding as Record<string, unknown>;
  const value = stored[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  // bootstrap 一旦落定，就以服务端这次下发的结果为准；不要再回退到首帧注入的旧值。
  if (store.booted) return '';
  const runtime = typeof window === 'undefined' ? undefined : window.__CALMOBILE_BRANDING__;
  const injected = runtime ? (runtime as Record<string, unknown>)[key] : undefined;
  return typeof injected === 'string' ? injected.trim() : '';
}

/** 应用名默认读文案表；构建期用 `PWA_APP_NAME` 覆盖时优先用它。 */
function pwaAppName(): string {
  const override = typeof __PWA_APP_NAME_OVERRIDE__ === 'string' ? __PWA_APP_NAME_OVERRIDE__.trim() : '';
  return override || t('app.documentTitle');
}

/** 每次身份切换后重读整份启动数据，偏好与权限落定后才允许进入下一屏。 */
export async function refreshRuntimeBootstrap(): Promise<void> {
  const signal = api.session.signal;
  const data = await api.bootstrap();
  signal.throwIfAborted();
  applyRuntimeBootstrap(data);
}

/**
 * 把启动数据落到各个 store。
 *
 * 明暗模式与强调色也在这里落一次：后端是偏好的权威来源（`users.ui_mode` /
 * `users.ui_theme`），本机缓存只负责首帧不闪白。
 */
export function applyRuntimeBootstrap(data: Bootstrap): void {
  useSessionStore().applyUser(data.user);
  useBootstrapStore().apply(data);
  // 品牌到了之后补一次标题与安装信息：首帧只有服务端注入的通用名/默认值。
  applyDocumentTitle();
  applyBrandingMeta();
  useCapabilitiesStore().apply(asObject(data.capabilities));
  // 色板与全局默认下标留在 bootstrap store；这里只落明暗模式那一段。
  useSettingsStore().apply({ ui: data.ui });
  applyMode(String(useSettingsStore().mode || 'auto'));
  // 强调色也缓存一份到本机：下次冷启动的首帧直接是用户选的颜色。
  applyAccentIndex(Number(useBootstrapStore().theme.index) || 0);
  // 语言包在本机。这里只记下服务器给的名称和链接，缺的包在后台补，不挡住这次启动。
  const lang = offeredLang(data.lang);
  if (!lang) return;
  if (applyOfferedLang(lang.defaultPack)) {
    reloadForLanguage();
    return;
  }
  const before = currentLanguageId();
  void downloadMissingPacks(lang.offers).then((errors) => {
    if (errors.length > 0) toast(errors.join('；'), 'error');
    if (currentLanguageId() !== before) reloadForLanguage();
  });
}

function offeredLang(value: unknown): { defaultPack: string; offers: LangOffer[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { defaultPack?: unknown; packs?: unknown };
  const offers: LangOffer[] = [];
  if (Array.isArray(record.packs)) {
    for (const item of record.packs) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as { id?: unknown }).id;
      const url = (item as { url?: unknown }).url;
      if (typeof id === 'string' && typeof url === 'string') offers.push({ id, url });
    }
  }
  return { defaultPack: typeof record.defaultPack === 'string' ? record.defaultPack : '', offers };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
