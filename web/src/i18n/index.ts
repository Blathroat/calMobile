/**
 * 界面文案的取用入口。内置中文在 `zh.json`。
 *
 * 谁读：所有页面、路由 `meta.title`、`app/shell.ts` 的导航标签。
 * 谁写：内置中文只改 `zh.json`。用户的语言包在本机，不进这张表。邮件正文在后端。
 *
 * 不变量：
 * - 路径用点连接，例如 `auth.login.title`。查找顺序是当前语言包 → 内置中文 → `fallback`。
 *   `fallback` 默认是路径本身。屏幕上直接出现这种路径，就是中文表里也没有这一条。
 * - 语言包或中文表里该条是空串时返回空串，不会继续往下走。
 * - **不是响应式的**。切换语言后整页重新加载。模块顶层取到的值会固定，
 *   正确做法仍是存路径、渲染时再 `t(path)`。
 * - 不做插值 / 复数 / 占位符。
 * - 下载语言包不走 `api/client.ts`：链接是用户或服务器给的任意地址，不能带上接口令牌。
 */
import { isJoinSurface } from '@/app/surface';
import builtinJson from './zh.json';
import {
  PACK_BYTES,
  PackError,
  chooseLanguage,
  fetchPack,
  installPack,
  overlayFor,
  parsePack,
  readLangState,
  rememberServerLang,
  removePack,
  resolveActiveId,
  writeLangState,
  type LangPack,
  type LangState,
} from './packs';

const builtin: Record<string, string> = Object.assign(Object.create(null), builtinJson);

const surface = isJoinSurface ? 'join' : 'app';

let state: LangState = readLangState(browserStorage());

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function persist(): void {
  writeLangState(browserStorage(), state);
}

function activeId(): string {
  return resolveActiveId(state, surface);
}

function lookup(path: string): string | undefined {
  const overlay = overlayFor(state, activeId());
  if (overlay && Object.prototype.hasOwnProperty.call(overlay, path)) return overlay[path];
  if (Object.prototype.hasOwnProperty.call(builtin, path)) return builtin[path];
  return undefined;
}

/**
 * 取一条界面文案。
 * @param path 点分路径，例如 `auth.login.title`
 * @param fallback 中文表也没有该条时的回退；缺省回退为路径本身
 */
export function t(path: string, fallback = path): string {
  return lookup(path) ?? fallback;
}

export function languageChoice(): string {
  return state.choice;
}

export function installedPacks(): { id: string; name: string }[] {
  return state.packs.map((pack) => ({ id: pack.id, name: pack.name }));
}

export function currentLanguageId(): string {
  return activeId();
}

/** 语言变了才重新加载。加载后本机记录已经对上，不会再加载一次。 */
export function reloadForLanguage(): void {
  const reload = window.location?.reload;
  if (typeof reload !== 'function') return;
  try {
    reload.call(window.location);
  } catch {
    // 测试里的 location.reload 可能没有实现。
  }
}

export function selectLanguage(choice: string): void {
  const next = chooseLanguage(state, choice);
  if (next.choice === state.choice) return;
  state = next;
  persist();
  reloadForLanguage();
}

export function deleteLanguage(id: string): void {
  const next = removePack(state, id);
  if (next.packs.length === state.packs.length) return;
  state = next;
  persist();
  // 列表和当前文案都不是响应式的，删掉就重新加载。
  reloadForLanguage();
}

export function chineseTemplate(): string {
  return `${JSON.stringify({ id: 'en', name: 'English', strings: { ...builtinJson } }, null, 2)}\n`;
}

export function downloadChineseTemplate(): void {
  const blob = new Blob([chineseTemplate()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'zh-template.json';
  link.click();
  URL.revokeObjectURL(url);
}

export function langErrorText(error: unknown): string {
  const code = error instanceof PackError ? error.code : 'badPack';
  return t(`settings.lang.${code}`);
}

function allowHttp(): boolean {
  return window.location?.protocol === 'http:';
}

async function installFromUrl(url: string, expectedId: string | undefined, replace: boolean): Promise<LangPack> {
  const pack = await fetchPack(url, expectedId, fetch, allowHttp());
  state = installPack(state, pack, replace);
  persist();
  return pack;
}

/** 设置里粘贴的链接：同 id 直接换掉，然后选中它。 */
export async function installPackFromUrl(url: string): Promise<void> {
  const pack = await installFromUrl(url, undefined, true);
  state = chooseLanguage(state, pack.id);
  persist();
  reloadForLanguage();
}

/** 本机文件。规则和链接一样。 */
export async function installPackFromText(text: string): Promise<void> {
  if (new TextEncoder().encode(text).length > PACK_BYTES) throw new PackError('badPack');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PackError('badPack');
  }
  const pack = parsePack(parsed);
  state = installPack(state, pack, true);
  state = chooseLanguage(state, pack.id);
  persist();
  reloadForLanguage();
}

export interface LangOffer {
  id: string;
  url: string;
}

/**
 * 收下 bootstrap 的语言段。报名站在默认名称不在列表里时不会改用本机已有的同名包。
 * 返回是否需要重新加载。调用方负责下载列表里还没有的包。
 */
export function applyOfferedLang(defaultPack: string, offers: readonly LangOffer[]): boolean {
  const before = activeId();
  state = rememberServerLang(
    state,
    defaultPack,
    offers.map((offer) => offer.id),
  );
  persist();
  return activeId() !== before;
}

/** 只补还没有的 id，不覆盖用户已经安装或改过的包。 */
export async function downloadMissingPacks(offers: readonly LangOffer[]): Promise<string[]> {
  const errors: string[] = [];
  for (const offer of offers) {
    if (state.packs.some((pack) => pack.id === offer.id)) continue;
    try {
      await installFromUrl(offer.url, offer.id, false);
    } catch (error) {
      errors.push(langErrorText(error));
    }
  }
  return errors;
}

/** 测试把模块状态恢复到空。 */
export function resetLangForTests(): void {
  state = readLangState(browserStorage());
}
