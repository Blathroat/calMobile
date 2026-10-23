/**
 * 通行密钥的调用层：App 里走原生桥（Android Credential Manager），浏览器里走原生 WebAuthn。
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
 * 模块顶层不碰 window：测试与 SSR 在导入时没有浏览器环境。
 */

import { nativeBridge, NativeBridgeError } from './native-bridge';

/** 提交给服务端的凭据：字段全是 base64url 字符串。 */
export interface PasskeyCredentialPayload {
  id: string;
  rawId: string;
  type: string;
  response: Record<string, string>;
}

/**
 * 当前环境能不能用通行密钥。
 *
 * App 里有原生桥就认为可用（真正的能力由 `passkey.available` 在调用时报错说明）；
 * 浏览器里要求 WebAuthn 接口存在且是安全上下文（https / localhost）。
 */
export function isPasskeySupported(): boolean {
  if (nativeBridge.hasNative()) return true;
  return (
    typeof window !== 'undefined' && window.isSecureContext === true && typeof window.PublicKeyCredential === 'function'
  );
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
    return parseBridgeCredential(result.credentialJson);
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

/** 统一处理底层调用：没有 WebAuthn / 用户取消返回 null，其它失败原样抛出。 */
async function requestCredential(run: () => Promise<Credential | null>): Promise<PasskeyCredentialPayload | null> {
  if (!isPasskeySupported() || typeof navigator === 'undefined' || !navigator.credentials) return null;
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
 * 创建通行密钥。
 * @param options 服务端下发的 PublicKeyCredentialCreationOptions JSON
 * @returns 可直接提交给 passkeyRegister 的普通对象；用户取消或环境不支持时返回 null
 */
export async function createCredential(options: unknown): Promise<PasskeyCredentialPayload | null> {
  // App 里由系统凭据提供方（Credential Manager）完成，选项 JSON 原样交给它。
  if (nativeBridge.hasNative()) return requestFromBridge('passkey.create', options);
  const publicKey = hydrateCreationOptions(options);
  if (!publicKey) return null;
  return requestCredential(() => navigator.credentials.create({ publicKey }));
}

/**
 * 用通行密钥做断言（登录）。
 * @param options 服务端下发的 PublicKeyCredentialRequestOptions JSON
 * @returns 可直接提交给 passkeyVerify 的普通对象；用户取消或环境不支持时返回 null
 */
export async function getCredential(options: unknown): Promise<PasskeyCredentialPayload | null> {
  if (nativeBridge.hasNative()) return requestFromBridge('passkey.get', options);
  const publicKey = hydrateRequestOptions(options);
  if (!publicKey) return null;
  return requestCredential(() => navigator.credentials.get({ publicKey }));
}
