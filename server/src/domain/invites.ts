/**
 * 展商邀请码。
 *
 * 码只把身份设为展商，不能设成管理员。生成时避开 0/O、1/I。
 * 兑换时只做去空白和大写，因此用户手打的 0 和 O 仍按原字符比对。
 */

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { query } from '../config/pool.js';
import { badRequest, notFound } from './errors.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export type InviteStatus = 'available' | 'exhausted' | 'expired' | 'revoked';

interface InviteRow {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: Date | string | null;
  created_at: Date | string;
  revoked_at: Date | string | null;
}

/** 去首尾空白并转成大写。空串表示没有填写。 */
export function normalizeInviteCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase();
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value: Date | string | null | undefined): string {
  const date = asDate(value);
  return date ? date.toISOString() : '';
}

/** 作废优先于过期，过期优先于用完。 */
export function inviteStatus(row: InviteRow, now = new Date()): InviteStatus {
  if (row.revoked_at) return 'revoked';
  const expires = asDate(row.expires_at);
  if (expires && expires.getTime() <= now.getTime()) return 'expired';
  if (Number(row.used_count) >= Number(row.max_uses)) return 'exhausted';
  return 'available';
}

function unusableMessage(row: InviteRow | null, now = new Date()): string | null {
  if (!row) return '邀请码无效';
  const status = inviteStatus(row, now);
  if (status === 'revoked') return '邀请码已作废';
  if (status === 'expired') return '邀请码已过期';
  if (status === 'exhausted') return '邀请码已用完';
  return null;
}

export function invitePayload(row: InviteRow) {
  return {
    id: row.id,
    code: row.code,
    maxUses: Number(row.max_uses),
    usedCount: Number(row.used_count),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    status: inviteStatus(row),
  };
}

const INVITE_COLUMNS = 'id, code, max_uses, used_count, expires_at, created_at, revoked_at';

async function findByCode(code: string, client?: PoolClient): Promise<InviteRow | null> {
  const sql = `SELECT ${INVITE_COLUMNS} FROM exhibitor_invites WHERE code = $1`;
  const result = client ? await client.query<InviteRow>(sql, [code]) : await query<InviteRow>(sql, [code]);
  return result.rows[0] || null;
}

/** 过期和已作废的码不再展示，列表时直接删掉。 */
async function purgeStaleInvites(): Promise<void> {
  await query(
    `DELETE FROM exhibitor_invites
      WHERE revoked_at IS NOT NULL
         OR (expires_at IS NOT NULL AND expires_at <= now())`,
  );
}

async function discardIfStale(row: InviteRow | null, client?: PoolClient): Promise<void> {
  if (!row) return;
  const status = inviteStatus(row);
  if (status !== 'expired' && status !== 'revoked') return;
  const sql = `DELETE FROM exhibitor_invites WHERE id = $1`;
  if (client) await client.query(sql, [row.id]);
  else await query(sql, [row.id]);
}

export async function listInvites(limit = 50) {
  await purgeStaleInvites();
  const result = await query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM exhibitor_invites ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => invitePayload(row));
}

/** 注册发码前先看一眼：无效码不发邮件，也不消耗邮箱验证码。返回规范化后的码。 */
export async function assertInviteUsable(raw: unknown): Promise<string> {
  const code = normalizeInviteCode(raw);
  if (!code) throw badRequest('邀请码无效');
  const row = await findByCode(code);
  const message = unusableMessage(row);
  if (message) {
    await discardIfStale(row);
    throw badRequest(message);
  }
  return code;
}

/** 在调用方的事务里把使用次数加一。加不上时按当前行说明原因。 */
export async function consumeInvite(client: PoolClient, raw: unknown): Promise<void> {
  const code = normalizeInviteCode(raw);
  if (!code) throw badRequest('邀请码无效');
  const updated = await client.query(
    `UPDATE exhibitor_invites
        SET used_count = used_count + 1
      WHERE code = $1
        AND revoked_at IS NULL
        AND used_count < max_uses
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING id`,
    [code],
  );
  if (updated.rowCount) return;
  const row = await findByCode(code, client);
  const message = unusableMessage(row);
  await discardIfStale(row, client);
  throw badRequest(message || '邀请码无效');
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[bytes[index]! % ALPHABET.length];
  }
  return code;
}

/** 次数夹到 1–100，小时数夹到 0–8760（一年）。0 小时表示不过期。码冲突时最多重试 5 次。 */
export async function createInvite(createdBy: string, uses: number, validHours: number) {
  const maxUses = Math.max(1, Math.min(100, Math.trunc(Number(uses)) || 1));
  const hours = Math.max(0, Math.min(24 * 365, Math.trunc(Number(validHours)) || 0));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `inv-${crypto.randomUUID()}`;
    const code = generateCode();
    try {
      await query(
        `INSERT INTO exhibitor_invites (id, code, max_uses, expires_at, created_by)
         VALUES ($1, $2, $3, CASE WHEN $4::int = 0 THEN NULL ELSE now() + make_interval(hours => $4::int) END, $5)`,
        [id, code, maxUses, hours, createdBy],
      );
      const row = await findByCode(code);
      if (!row) throw new Error('邀请码写入后读不到');
      return invitePayload(row);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') continue;
      throw error;
    }
  }
  throw badRequest('邀请码生成失败，请再试一次');
}

/** 删除后列表里不再出现。找不到才是 404。 */
export async function deleteInvite(id: string) {
  const result = await query(`DELETE FROM exhibitor_invites WHERE id = $1 RETURNING id`, [id]);
  if (!result.rowCount) throw notFound('邀请码不存在');
  return listInvites();
}
