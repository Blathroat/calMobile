/**
 * 通行密钥（passkey / WebAuthn）的数据与选项构造。
 *
 * 三件事分开放在这里，路由只做参数校验与响应包装：
 * 1. **挑战**：一次一用、10 分钟过期，服务端只存自己生成的那一串，消费时原子删除；
 * 2. **凭据**：credential id 与 COSE 公钥都按 base64url 存，counter 每次断言后回写，
 *    用于识别被克隆的认证器；
 * 3. **选项**：调 @simplewebauthn/server 生成，服务端不自己拼 CBOR、不自己解析认证器数据。
 *
 * 凭据列表（listCredentials）刻意**不返回** credentialId / publicKey：
 * 前者除了登录提交通道没有别的用处，后者是安全材料，页面不需要它们。
 */

import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { query } from '../config/pool.js';

/** 挑战类型：注册（绑定新凭据）与断言（登录）不能混用。 */
export type ChallengeKind = 'registration' | 'authentication';

/** 挑战有效期：用户要在 10 分钟内完成浏览器弹窗里的指纹 / 面容确认。 */
export const CHALLENGE_TTL_MIN = 10;

/** 挑战过期后还留着的时间窗口：超过这个窗口的行在下次签发时清掉。 */
const CHALLENGE_PURGE_AFTER_HOURS = 24;

/** 列表与选项里用到的凭据描述（不含公钥与 credential id）。 */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  transports: string[];
}

/** 校验注册 / 登录响应时需要的 RP 参数（来自环境变量，见 config/env.ts）。 */
export interface PasskeyRelyingParty {
  rpId: string;
  origins: string[];
}

/** 认证器支持的传输方式（usb / nfc / ble / internal / hybrid）；解析不出来就当空数组。 */
function transportsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function iso(value: unknown): string {
  return value ? new Date(value as string | number | Date).toISOString() : '';
}

interface CredentialRow {
  id: string;
  name?: string | null;
  created_at?: string | Date | null;
  last_used_at?: string | Date | null;
  transports?: unknown;
  user_id?: string;
  credential_id?: string;
  public_key?: string;
  counter?: number | string | null;
}

/**
 * 签发一条挑战。
 *
 * 顺带清掉过期超过一天的行：挑战表只需要保留「还在等用户操作」的那些。
 * 清理失败不影响签发 —— 记录的是挑战，不是账。
 */
export async function issueChallenge(userId: string, kind: ChallengeKind, challenge: string): Promise<string> {
  await query(`DELETE FROM webauthn_challenges WHERE expires_at < now() - ($1 || ' hours')::interval`, [
    String(CHALLENGE_PURGE_AFTER_HOURS),
  ]).catch((error: unknown) => {
    console.warn('清理过期通行密钥挑战失败：', error instanceof Error ? error.message : String(error));
  });
  const id = `pkc-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO webauthn_challenges (id, user_id, kind, challenge, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [id, userId, kind, challenge, String(CHALLENGE_TTL_MIN)],
  );
  return id;
}

/**
 * 原子消费一条挑战：删除并返回挑战串。
 *
 * 不存在、已过期、类型不符（注册的挑战拿去登录）一律返回 null，由路由给 `ok:false`。
 * 用 DELETE ... RETURNING 而不是「先查再删」：并发提交两次时只有一个能拿到非空结果。
 */
export async function consumeChallenge(
  challengeId: unknown,
  userId: string,
  kind: ChallengeKind,
): Promise<string | null> {
  const id = String(challengeId ?? '').trim();
  if (!id || id.length > 80) {
    return null;
  }
  const result = await query<{ challenge: string }>(
    `DELETE FROM webauthn_challenges
      WHERE id = $1 AND user_id = $2 AND kind = $3 AND expires_at > now()
      RETURNING challenge`,
    [id, userId, kind],
  );
  return result.rows[0]?.challenge ?? null;
}

/** 某个账号已绑定的凭据列表（时间按 ISO 下发，页面直接显示）。 */
export async function listCredentials(userId: string): Promise<PasskeySummary[]> {
  const result = await query<CredentialRow>(
    `SELECT id, name, created_at, last_used_at, transports
       FROM passkey_credentials
      WHERE user_id = $1
      ORDER BY created_at`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: String(row.name || ''),
    createdAt: iso(row.created_at),
    lastUsedAt: iso(row.last_used_at),
    transports: transportsOf(row.transports),
  }));
}

/** 已绑定凭据的 id 与传输方式：注册时放进 excludeCredentials，避免同一认证器重复绑定。 */
export async function listCredentialDescriptors(userId: string): Promise<{ id: string; transports: string[] }[]> {
  const result = await query<CredentialRow>(
    'SELECT credential_id, transports FROM passkey_credentials WHERE user_id = $1',
    [userId],
  );
  return result.rows
    .map((row) => ({ id: String(row.credential_id || ''), transports: transportsOf(row.transports) }))
    .filter((item) => item.id !== '');
}

/** 绑定了几枚凭据。两枚以上才能在「其它方式」不可用时删掉其中一枚。 */
export async function countCredentials(userId: string): Promise<number> {
  const result = await query<{ total: number }>(
    'SELECT count(*)::int AS total FROM passkey_credentials WHERE user_id = $1',
    [userId],
  );
  return Number(result.rows[0]?.total) || 0;
}

export interface SaveCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
}

/** 保存一枚新凭据；credentialId 全局唯一由数据库兜底（重复绑定会报唯一冲突）。 */
export async function saveCredential(input: SaveCredentialInput): Promise<string> {
  const id = `pk-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, counter, transports, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.userId,
      input.credentialId,
      input.publicKey,
      input.counter,
      JSON.stringify(input.transports),
      input.name,
    ],
  );
  return id;
}

/** 删除调用者自己的凭据；不是本人的 id 一律删不动（不泄露它是否存在）。 */
export async function removeCredential(userId: string, id: string): Promise<boolean> {
  const result = await query('DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rowCount === 1;
}

/** 按 credential id 找凭据（登录断言用）；找不到返回 null。 */
export async function findCredentialByCredentialId(credentialId: string): Promise<{
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
} | null> {
  const result = await query<CredentialRow>(
    `SELECT id, user_id, credential_id, public_key, counter, transports
       FROM passkey_credentials WHERE credential_id = $1`,
    [credentialId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    userId: String(row.user_id || ''),
    credentialId: String(row.credential_id || ''),
    publicKey: String(row.public_key || ''),
    counter: Number(row.counter) || 0,
    transports: transportsOf(row.transports),
  };
}

/** 登录成功后回写认证器计数与最近使用时间；计数只增不减，防止被旧值覆盖。 */
export async function touchCredential(id: string, counter: number): Promise<void> {
  await query(
    `UPDATE passkey_credentials
        SET counter = GREATEST(counter, $2), last_used_at = now()
      WHERE id = $1`,
    [id, Math.max(0, Math.trunc(Number(counter) || 0))],
  );
}

export interface RegistrationOptionsInput {
  rp: { rpId: string; rpName: string };
  user: { id: string; username: string; email?: string; displayName?: string };
  excludeCredentials: { id: string; transports?: string[] }[];
}

/**
 * 生成注册选项（浏览器 navigator.credentials.create 的入参）。
 *
 * - challenge 与 user.id 由库编码成 base64url 字符串，直接 JSON 下发；
 * - authenticatorSelection 用 residentKey / userVerification 都是 preferred：
 *   让系统弹窗自己决定用设备内置认证器还是外接安全密钥，不强求常驻凭据；
 * - userID 用账号 id 的 UTF-8 字节：同一账号换设备再绑，浏览器能识别出是同一个人。
 */
export async function buildRegistrationOptions(
  input: RegistrationOptionsInput,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rp.rpName,
    rpID: input.rp.rpId,
    userName: input.user.email || input.user.username,
    userID: new TextEncoder().encode(input.user.id),
    userDisplayName: input.user.displayName || input.user.username,
    excludeCredentials: input.excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
}

/** 生成断言选项（浏览器 navigator.credentials.get 的入参）；allowCredentials 为该账号已绑定的凭据。 */
export async function buildAuthenticationOptions(input: {
  rpId: string;
  allowCredentials: { id: string; transports?: string[] }[];
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allowCredentials,
    userVerification: 'preferred',
  });
}

/**
 * 把 WebAuthn 库的校验错误翻成给用户看的一句话。
 *
 * 域名 / RP ID 对不上与「凭据本身不对」要分开说：前者是用户打开了错误的地址，
 * 照着提示换到应用的正式地址就能继续；后者重试即可。
 */
export function passkeyVerifyFailure(error: unknown): { error: string; errorCode: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/origin|rp ?id/i.test(message)) {
    return { error: '当前地址不允许使用通行密钥，请用应用的正式地址打开', errorCode: 'security.passkeyOrigin' };
  }
  return { error: '通行密钥验证没有通过，请重试', errorCode: 'security.passkeyInvalid' };
}

export interface VerifiedRegistration {
  credentialId: string;
  /** base64url 的 COSE 公钥。 */
  publicKey: string;
  counter: number;
  transports: string[];
}

/**
 * 校验注册响应。
 *
 * 校验内容全部交给库：origin、RP ID、challenge、attestation、签名与公钥结构都在里面；
 * 服务端只把结果转成库里需要的形状。校验不通过（verified=false）返回 null，
 * 参数不符（例如 origin 对不上）会抛错，由路由翻成给用户看的失败文案。
 */
export async function verifyPasskeyRegistration(input: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  rp: PasskeyRelyingParty;
}): Promise<VerifiedRegistration | null> {
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.rp.origins,
    expectedRPID: input.rp.rpId,
  });
  if (!verification.verified) {
    return null;
  }
  const credential = verification.registrationInfo.credential;
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
  };
}

/** 校验登录断言；counter 不前进（被克隆的认证器）时由库抛错，路由按验证失败处理。 */
export async function verifyPasskeyAuthentication(input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  rp: PasskeyRelyingParty;
  credential: { id: string; publicKey: string; counter: number; transports: string[] };
}): Promise<{ counter: number } | null> {
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.rp.origins,
    expectedRPID: input.rp.rpId,
    credential: {
      id: input.credential.id,
      publicKey: Buffer.from(input.credential.publicKey, 'base64url'),
      counter: input.credential.counter,
      transports: input.credential.transports,
    },
  });
  if (!verification.verified) {
    return null;
  }
  return { counter: verification.authenticationInfo.newCounter };
}
