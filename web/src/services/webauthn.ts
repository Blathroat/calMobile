/**
 * 通行密钥的调用层：App 里走原生桥（Android Credential Manager），浏览器里走原生 WebAuthn。
 *
 * 旧 APK 可能还没有 `passkey.*` 动作：新页面先随热更新上线，能力协商（`supportsNativeAction`）
 * 说不支持时退回浏览器 WebAuthn（与没有原生桥时同一套逻辑），不把「APK 没更新」显示成失败。
 *
 * 两条路返回的东西是一样的：服务端要的 `{ id, rawId, type, response }`，
 * 字段全是 base64url 字符串。所以上层（安全页、登录页）只认本模块的三个导出，
 * 不需要知道当前跑在哪种容器里。
 *
 * 浏览器分支是「原生 WebAuthn 的薄封装」（不引第三方库）。
 *
 * 服务端下发的注册 / 认证选项里，`challenge`、`user.id` 以及凭据描述符的 `id`
 * 都是 base64url 字符串；浏览器只认 ArrayBuffer，所以进入时还原、提交时再序列化回
 * base64url 的普通对象（ArrayBuffer 不能 JSON 化）。这里只做这两次转换，以及把
 * 「用户取消」归一成 `null`。
 *
 * **只有「用户取消」才返回 `null`**：原生回包解析不出来、旧壳没有通行密钥动作而
 * WebView 又没有 WebAuthn 时，抛一句可读中文让页面显示原因。以前这些情况一起返回 null，
 * 页面把「失败」当成「用户取消」静默收场，看起来就像点了没反应。
 *
 * 模块顶层不碰 window：测试与 SSR 在导入时没有浏览器环境。
 */

import { t } from '@/i18n';
import { NativeBridgeError, nativeBridge, supportsNativeAction } from './native-bridge';

/** 提交给服务端的凭据：字段全是 base64url 字符串。 */
export interface PasskeyCredentialPayload {
  id: string;
  rawId: string;
  type: string;
  response: Record<string, string>;
}

/** 浏览器里能不能用 WebAuthn：接口存在且是安全上下文（https / localhost）。 */
function browserPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' && window.isSecureContext === true && typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * 当前环境能不能用通行密钥（同步快速判断，供页面首帧决定摆不摆入口）。
 *
 * App 里有原生桥先乐观返回真 —— 真正能不能走原生由 `canUseNativePasskey()` 在调用时用
 * `supportsNativeAction('passkey.available')` 与具体动作判断，旧壳没有通行密钥动作时退回浏览器
 * WebAuthn；都没有时沿用原有路径（返回 null，页面按不可用处理）。浏览器里要求 WebAuthn 接口存在
 * 且是安全上下文。
 */
export function isPasskeySupported(): boolean {
  if (nativeBridge.hasNative()) return true;
  return browserPasskeySupported();
}

/**
 * 原生桥成功回调里没有可用的 WebAuthn 响应（缺字段 / 不是 JSON）。
 *
 * 这不是用户取消：必须抛出来让页面显示失败，否则抽屉会被静默关掉。
 */
function bridgePayloadError(): NativeBridgeError {
  return new NativeBridgeError(t('device.passkeyBroken'));
}

/** 旧壳没有通行密钥动作，而当前容器（WebView）也没有 WebAuthn：明确告诉用户要更新应用。 */
function shellOutdatedError(): NativeBridgeError {
  return new NativeBridgeError(t('device.passkeyShellOutdated'));
}

/** 解析原生返回的标准 WebAuthn 响应 JSON。字段已经是 base64url，不用再转换。 */
function parseBridgeCredential(raw: unknown): PasskeyCredentialPayload | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.response)) return null;
    return parsed as unknown as PasskeyCredentialPayload;
  } catch {
    return null;
  }
}

/**
 * 走原生桥拿凭据。
 *
 * 用户在系统面板上取消时原生回 `cancelled`，这里和浏览器分支一样归一成 `null`；
 * 其余失败原样抛出，由页面显示能照着做的说明（例如设备没有可用的凭据提供方）。
 */
async function requestFromBridge(
  action: 'passkey.create' | 'passkey.get',
  options: unknown,
): Promise<PasskeyCredentialPayload | null> {
  try {
    const result = await nativeBridge.call(action, { optionsJson: JSON.stringify(options ?? {}) });
    const credential = parseBridgeCredential(result?.credentialJson);
    if (!credential) throw bridgePayloadError();
    return credential;
  } catch (reason) {
    if (reason instanceof NativeBridgeError && reason.code === 'cancelled') return null;
    throw reason;
  }
}

/** ArrayBuffer → base64url（去掉尾部填充）。 */
function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/** base64url → ArrayBuffer；空串得到空缓冲，服务端字段缺失时不会在解码处抛错。 */
function decodeBase64Url(value: unknown): ArrayBuffer {
  const normalized = String(value ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 凭据描述符（excludeCredentials / allowCredentials）：把 id 还原成 ArrayBuffer。 */
function hydrateDescriptors(items: unknown[]): unknown[] {
  return items.map((item) => {
    const descriptor = isRecord(item) ? item : {};
    return { ...descriptor, id: decodeBase64Url(descriptor.id) };
  });
}

/** 注册选项：challenge 与 user.id 是二进制；返回可直接交给 credentials.create 的对象。 */
function hydrateCreationOptions(raw: unknown): PublicKeyCredentialCreationOptions | null {
  if (!isRecord(raw)) return null;
  const options: Record<string, unknown> = { ...raw, challenge: decodeBase64Url(raw.challenge) };
  const user = isRecord(raw.user) ? raw.user : {};
  options.user = { ...user, id: decodeBase64Url(user.id) };
  if (Array.isArray(raw.excludeCredentials)) options.excludeCredentials = hydrateDescriptors(raw.excludeCredentials);
  return options as unknown as PublicKeyCredentialCreationOptions;
}

/** 认证选项：challenge 与 allowCredentials[].id 是二进制。 */
function hydrateRequestOptions(raw: unknown): PublicKeyCredentialRequestOptions | null {
  if (!isRecord(raw)) return null;
  const options: Record<string, unknown> = { ...raw, challenge: decodeBase64Url(raw.challenge) };
  if (Array.isArray(raw.allowCredentials)) options.allowCredentials = hydrateDescriptors(raw.allowCredentials);
  return options as unknown as PublicKeyCredentialRequestOptions;
}

/** 用户取消或超时：浏览器统一报 NotAllowedError，按「没做这件事」处理。 */
function isCancelled(reason: unknown): boolean {
  return isRecord(reason) && reason.name === 'NotAllowedError';
}

/**
 * 把浏览器返回的凭据序列化成普通对象。
 *
 * 注册（attestation）带 clientDataJSON / attestationObject；认证（assertion）带
 * clientDataJSON / authenticatorData / signature / userHandle —— 服务端两边的
 * clientDataJSON 都要拿来核对 challenge 与来源。
 */
function serializeCredential(credential: PublicKeyCredential): PasskeyCredentialPayload {
  const response = credential.response as unknown as Record<string, unknown>;
  const body: Record<string, string> = {};
  for (const field of ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature']) {
    const value = response[field];
    if (value instanceof ArrayBuffer) body[field] = encodeBase64Url(value);
  }
  if ('userHandle' in response) {
    body.userHandle = response.userHandle instanceof ArrayBuffer ? encodeBase64Url(response.userHandle) : '';
  }
  return {
    id: String(credential.id ?? ''),
    rawId: encodeBase64Url(credential.rawId),
    type: String(credential.type || 'public-key'),
    response: body,
  };
}

/**
 * 统一处理浏览器分支：用户取消返回 null，其它失败原样抛出。
 *
 * 浏览器不支持 WebAuthn 时返回 null：调用方只在「当前环境不支持」时走到这里
 * （App 里旧壳回退且 WebView 没有 WebAuthn 的情况在调用处就明确失败了）。
 */
async function requestCredential(run: () => Promise<Credential | null>): Promise<PasskeyCredentialPayload | null> {
  if (!browserPasskeySupported() || typeof navigator === 'undefined' || !navigator.credentials) return null;
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (reason) {
    if (isCancelled(reason)) return null;
    throw reason;
  }
  return credential ? serializeCredential(credential as PublicKeyCredential) : null;
}

/**
 * 原生壳里能不能走通行密钥：能力清单里同时有 `passkey.available` 与这次要用的动作。
 *
 * 旧壳整份清单为空时直接 false，退回浏览器 WebAuthn（与没有原生桥时同一套逻辑）；
 * 能力协商只问一次，两项判断共用缓存。
 */
async function canUseNativePasskey(action: 'passkey.create' | 'passkey.get'): Promise<boolean> {
  if (!(await supportsNativeAction('passkey.available'))) return false;
  return supportsNativeAction(action);
}

/**
 * 创建通行密钥。
 * @param options 服务端下发的 PublicKeyCredentialCreationOptions JSON
 * @returns 可直接提交给 passkeyRegister 的普通对象；**只有用户取消**返回 null，
 *   其它失败（旧壳不支持、选项损坏、系统拒绝）都抛出可读中文。
 */
export async function createCredential(options: unknown): Promise<PasskeyCredentialPayload | null> {
  // App 里由系统凭据提供方（Credential Manager）完成，选项 JSON 交给原生校验后再递给系统。
  if (nativeBridge.hasNative()) {
    if (await canUseNativePasskey('passkey.create')) return requestFromBridge('passkey.create', options);
    // 旧壳没有这个动作：按能力协商退回浏览器实现；WebView 里通常没有 WebAuthn，
    // 这时必须明确失败，否则页面会把「返回 null」当成用户取消而静默收起抽屉。
    if (!browserPasskeySupported()) throw shellOutdatedError();
  }
  const publicKey = hydrateCreationOptions(options);
  if (!publicKey) throw bridgePayloadError();
  return requestCredential(() => navigator.credentials.create({ publicKey }));
}

/**
 * 用通行密钥做断言（登录）。
 * @param options 服务端下发的 PublicKeyCredentialRequestOptions JSON
 * @returns 可直接提交给 passkeyVerify 的普通对象；**只有用户取消**返回 null，
 *   其它失败（旧壳不支持、选项损坏、系统拒绝）都抛出可读中文。
 */
export async function getCredential(options: unknown): Promise<PasskeyCredentialPayload | null> {
  // 旧壳没有 `passkey.get` 时同样退回浏览器 WebAuthn。
  if (nativeBridge.hasNative()) {
    if (await canUseNativePasskey('passkey.get')) return requestFromBridge('passkey.get', options);
    if (!browserPasskeySupported()) throw shellOutdatedError();
  }
  const publicKey = hydrateRequestOptions(options);
  if (!publicKey) throw bridgePayloadError();
  return requestCredential(() => navigator.credentials.get({ publicKey }));
}
