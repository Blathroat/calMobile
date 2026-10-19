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
 * 页面标题（浏览器页签、分享预览）。HTML 里只留品牌，语言相关的名字在这里落一次：
 * 应用与报名站各有各的名字，靠 `isJoinSurface` 区分。切语言会整页重载，所以不用监听。
 */
function applyDocumentTitle(): void {
  if (typeof document === 'undefined') return;
  document.title = t(isJoinSurface ? 'join.documentTitle' : 'app.documentTitle');
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
  useCapabilitiesStore().apply(asObject(data.capabilities));
  // 色板与全局默认下标留在 bootstrap store；这里只落明暗模式那一段。
  useSettingsStore().apply({ ui: data.ui });
  applyMode(String(useSettingsStore().mode || 'auto'));
  // 强调色也缓存一份到本机：下次冷启动的首帧直接是用户选的颜色。
  applyAccentIndex(Number(useBootstrapStore().theme.index) || 0);
  // 语言包在本机。这里只记下服务器给的名称和链接，缺的包在后台补，不挡住这次启动。
  const lang = offeredLang(data.lang);
  if (!lang) return;
  if (applyOfferedLang(lang.defaultPack, lang.offers)) {
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
