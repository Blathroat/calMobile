/**
 * 语言包的形状、校验和该用哪一种语言。
 *
 * 正文不放在这里。内置中文在 `zh.json`，用户安装的包在本机 `localStorage`，
 * 不进页面包，所以热更新和部署都不会盖掉。
 *
 * 不变量：
 * - 包 id 是小写字母、数字和连字符，1–32 位。
 * - 缺键回中文由调用方做；这里只判断「当前用哪一个包」。
 * - 报名站只认 `joinDefault`。这个值只有在服务器默认名称写进下载列表时才会被记下。
 * - 应用先认用户的选择，没选过才认服务器默认名称。
 */

export const PACK_LIMIT = 8;
export const PACK_BYTES = 400 * 1024;
const PACK_ID = /^[a-z0-9-]{1,32}$/;
const STRING_KEY = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;

export type PackErrorCode = 'badPack' | 'badUrl' | 'idMismatch' | 'tooMany' | 'downloadFailed';

export class PackError extends Error {
  readonly code: PackErrorCode;

  constructor(code: PackErrorCode) {
    super(code);
    this.name = 'PackError';
    this.code = code;
  }
}

export interface LangPack {
  id: string;
  name: string;
  strings: Record<string, string>;
  url?: string;
}

export interface LangState {
  packs: LangPack[];
  /** 应用里用户选过的 id。空串表示还没选。`zh` 是明确选择中文。 */
  choice: string;
  /** 最近一次 bootstrap 的默认名称。应用在没选过语言时用它。 */
  serverDefault: string;
  /** 报名站可用的默认名称。不在下载列表里时是空串。 */
  joinDefault: string;
}

export const EMPTY_LANG_STATE: LangState = { packs: [], choice: '', serverDefault: '', joinDefault: '' };

export function isPackId(value: string): boolean {
  return PACK_ID.test(value);
}

/** 把任意 JSON 收成语言包。不符合就抛 `PackError`，不返回半份。 */
export function parsePack(value: unknown, expectedId?: string): LangPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PackError('badPack');
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!isPackId(id) || !name || [...name].length > 40) throw new PackError('badPack');
  if (expectedId && id !== expectedId) throw new PackError('idMismatch');
  if (!record.strings || typeof record.strings !== 'object' || Array.isArray(record.strings)) {
    throw new PackError('badPack');
  }
  const strings: Record<string, string> = Object.create(null);
  for (const [key, item] of Object.entries(record.strings as Record<string, unknown>)) {
    if (!STRING_KEY.test(key) || typeof item !== 'string') throw new PackError('badPack');
    strings[key] = item;
  }
  return { id, name, strings };
}

export function packBytes(pack: LangPack): number {
  return new TextEncoder().encode(JSON.stringify(pack)).length;
}

/** 当前该用的语言包 id。`zh` 表示内置中文，可以再叠一个 id 为 `zh` 的包。 */
export function resolveActiveId(state: LangState, surface: 'app' | 'join'): string {
  const installed = (id: string) => state.packs.some((pack) => pack.id === id);
  if (surface === 'join') {
    return state.joinDefault && installed(state.joinDefault) ? state.joinDefault : 'zh';
  }
  if (state.choice === 'zh') return 'zh';
  if (state.choice && installed(state.choice)) return state.choice;
  if (!state.choice && state.serverDefault && installed(state.serverDefault)) return state.serverDefault;
  return 'zh';
}

export function overlayFor(state: LangState, id: string): Record<string, string> | null {
  return state.packs.find((pack) => pack.id === id)?.strings ?? null;
}

/**
 * 记下服务器下发的默认名称。
 * 报名站的 `joinDefault` 只在该名称确实出现在下载列表里时保留。
 */
export function rememberServerLang(state: LangState, defaultPack: string, offeredIds: readonly string[]): LangState {
  const nextDefault = isPackId(defaultPack) ? defaultPack : '';
  return {
    ...state,
    serverDefault: nextDefault,
    joinDefault: nextDefault && offeredIds.includes(nextDefault) ? nextDefault : '',
  };
}

/** 装入一个包。`replace` 为假时，同 id 已存在则原样返回。超过 8 个新包会抛错。 */
export function installPack(state: LangState, pack: LangPack, replace: boolean): LangState {
  if (packBytes(pack) > PACK_BYTES) throw new PackError('badPack');
  const existing = state.packs.findIndex((item) => item.id === pack.id);
  if (existing >= 0 && !replace) return state;
  if (existing < 0 && state.packs.length >= PACK_LIMIT) throw new PackError('tooMany');
  const packs = state.packs.slice();
  if (existing >= 0) packs[existing] = pack;
  else packs.push(pack);
  return { ...state, packs };
}

export function removePack(state: LangState, id: string): LangState {
  const packs = state.packs.filter((pack) => pack.id !== id);
  const choice = state.choice === id ? '' : state.choice;
  return { ...state, packs, choice };
}

export function chooseLanguage(state: LangState, choice: string): LangState {
  if (choice === '' || choice === 'zh') return { ...state, choice };
  if (!state.packs.some((pack) => pack.id === choice)) return state;
  return { ...state, choice };
}

const PACKS_KEY = 'calmobile.lang.packs';
const CHOICE_KEY = 'calmobile.lang.choice';
const SERVER_KEY = 'calmobile.lang.server';
const JOIN_KEY = 'calmobile.lang.join';

export function readLangState(storage: Pick<Storage, 'getItem'> | null): LangState {
  if (!storage) return { ...EMPTY_LANG_STATE };
  return {
    packs: readPacks(storage.getItem(PACKS_KEY)),
    choice: readChoice(storage.getItem(CHOICE_KEY)),
    serverDefault: readId(storage.getItem(SERVER_KEY)),
    joinDefault: readId(storage.getItem(JOIN_KEY)),
  };
}

export function writeLangState(storage: Pick<Storage, 'setItem'> | null, state: LangState): void {
  if (!storage) return;
  storage.setItem(PACKS_KEY, JSON.stringify(state.packs.map(storedPack)));
  storage.setItem(CHOICE_KEY, state.choice);
  storage.setItem(SERVER_KEY, state.serverDefault);
  storage.setItem(JOIN_KEY, state.joinDefault);
}

function storedPack(pack: LangPack): LangPack {
  return pack.url
    ? { id: pack.id, name: pack.name, strings: pack.strings, url: pack.url }
    : { id: pack.id, name: pack.name, strings: pack.strings };
}

function readPacks(raw: string | null): LangPack[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const packs: LangPack[] = [];
    for (const item of parsed) {
      if (packs.length >= PACK_LIMIT) break;
      try {
        const pack = parsePack(item);
        if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
          pack.url = (item as { url: string }).url;
        }
        if (packBytes(pack) <= PACK_BYTES) packs.push(pack);
      } catch {
        // 坏掉的一条丢掉，不能让整个列表失效。
      }
    }
    return packs;
  } catch {
    return [];
  }
}

function readChoice(raw: string | null): string {
  if (raw === 'zh') return 'zh';
  return raw && isPackId(raw) ? raw : '';
}

function readId(raw: string | null): string {
  return raw && isPackId(raw) ? raw : '';
}

/** 只接受 https。页面自己是 http 时才接受 http，避免正式站去拉明文。 */
export function assertPackUrl(value: string, allowHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PackError('badUrl');
  }
  if (url.username || url.password || url.hash) throw new PackError('badUrl');
  if (url.protocol === 'https:') return url;
  if (allowHttp && url.protocol === 'http:') return url;
  throw new PackError('badUrl');
}

export async function fetchPack(
  url: string,
  expectedId: string | undefined,
  fetchImpl: typeof fetch,
  allowHttp: boolean,
): Promise<LangPack> {
  const target = assertPackUrl(url, allowHttp);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(target.toString(), {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new PackError('downloadFailed');
    if (response.url) assertPackUrl(response.url, allowHttp);
    const text = await response.text();
    if (new TextEncoder().encode(text).length > PACK_BYTES) throw new PackError('badPack');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PackError('badPack');
    }
    const pack = parsePack(parsed, expectedId);
    pack.url = target.toString();
    return pack;
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError('downloadFailed');
  } finally {
    clearTimeout(timer);
  }
}
