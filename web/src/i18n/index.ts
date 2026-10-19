/**
 * 界面文案的取用入口。内置中文在 `zh.json`（嵌套 JSON，加载时压成扁平表）。
 *
 * 谁读：所有页面、路由 `meta.title`、`app/shell.ts` 的导航标签。
 * 谁写：内置中文只改 `zh.json`。用户的语言包在本机，不进这张表。邮件正文在后端。
 *
 * 不变量：
 * - 路径用点连接，例如 `auth.login.title`。查找顺序是当前语言包 → 内置中文 → `fallback`。
 *   `fallback` 默认是路径本身。屏幕上直接出现这种路径，就是中文表里也没有这一条。
 *   调用方看到的永远是扁平表：`zh.json` 与语言包文件写嵌套，只是为了人改的时候不用把
 *   长前缀抄一遍（见下面的 `flattenStrings()`）。
 * - 语言包或中文表里该条是空串时返回空串，不会继续往下走。
 * - **不是响应式的**。切换语言后整页重新加载。模块顶层取到的值会固定，
 *   正确做法仍是存路径、渲染时再 `t(path)`。
 * - 只做一种插值：文案里写 `{name}`，取值时用第二个参数按名字替换（见 `t()`）。
 *   没有复数、没有性别、没有嵌套。参数里缺的名字原样留在屏幕上——跟整条缺失时显示路径
 *   同一个道理，缺哪条一眼能看见。值只接受字符串与数字。
 *   带变量的整句写进 `zh.json`，调用处不要再把取到的文案拼给别人看。
 * - 下载语言包不走 `api/client.ts`：链接是用户或服务器给的任意地址，不能带上接口令牌。
 * - 这里只提供纯函数 `chineseTemplate()`：落到文件、系统「另存为」和提示都属于页面层，
 *   而且不能在这里 import `services/device-services.ts`——`native-bridge` 反过来 import 本模块，会成环。
 * - 安装 / 切换语言会整页重载，所以提示先用 `services/toast.ts` 的 `toastAfterReload()` 排队。
 */
import { isJoinSurface } from '@/app/surface';
import { toastAfterReload } from '@/services/toast';
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

/**
 * 嵌套表压成点分路径的扁平表。
 *
 * `zh.json` 与用户语言包都用嵌套 JSON 写，人改的时候不用重复抄长前缀；但运行时查找
 * （下面的 `lookup()`、`overlayFor()`、`t()`）都在按点分路径索引的扁平表里做，
 * 热路径上不必每层 `split`，所以模块加载时压一次。
 * 中文表是打进页面包的构建产物，形状可信：只收字符串叶子，其余静默跳过。
 */
function flattenStrings(node: Record<string, unknown>, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat[path] = value;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flattenStrings(value as Record<string, unknown>, path));
    }
  }
  return flat;
}

const builtin: Record<string, string> = flattenStrings(builtinJson as Record<string, unknown>);

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

/** 插值参数：名字对应文案里的 `{name}`，值是字符串或数字。 */
export type TParams = Record<string, string | number>;

/** 占位的形状：名字用字母、数字与下划线。 */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** 把文案里的 `{name}` 换成参数值；参数里没有的名字、或值不是字符串与数字，都原样留着。 */
function fill(text: string, params: TParams | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : whole;
  });
}

/**
 * 取一条界面文案。
 * @param path 点分路径，例如 `auth.login.title`
 * @param params 占位值，对应文案里的 `{name}`；可以是字符串或数字，缺哪个占位就原样留着
 * @param fallback 中文表也没有该条时的回退；缺省回退为路径本身
 */
export function t(path: string, params?: TParams, fallback = path): string {
  return fill(lookup(path) ?? fallback, params);
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

/** 下载给用户改的中文底稿：与 `zh.json` 一样是嵌套结构，装上就能用。 */
export function chineseTemplate(): string {
  return `${JSON.stringify({ id: 'en', name: 'English', strings: builtinJson }, null, 2)}\n`;
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
  // 重载会把当场弹的气泡冲掉，排队到重载后再弹（外壳挂载时 flushDeferredToast()）。
  toastAfterReload(t('settings.lang.installDone'), 'success');
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
  // 与链接安装同一条：重载后再弹。
  toastAfterReload(t('settings.lang.installDone'), 'success');
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
