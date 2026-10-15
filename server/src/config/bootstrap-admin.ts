/**
 * 生产环境的初始管理员。
 *
 * 只在账号还不存在时创建。已存在的管理员不改密码：环境变量不是每次启动都覆盖口令的后门。
 * 用户名被普通账号占用时拒绝提权。示例账号若仍能用 `password` 登录，启动会被拒绝。
 */

import bcrypt from 'bcryptjs';
import type { QueryResultRow } from 'pg';
import type { AdminIdentity } from './production.js';

export interface AdminDb {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** 开发 seed 写入的三个账号。生产库里只要还能用示例口令登录就拒绝启动。 */
export const DEMO_USERNAMES = ['demo', 'exhibitor', 'user'] as const;

const DEMO_PASSWORD = 'password';

function pgCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

export async function demoAccountsUsingExamplePassword(db: AdminDb): Promise<string[]> {
  const found = await db.query<{ username: string; password_hash: string }>(
    'SELECT username, password_hash FROM users WHERE username = ANY($1::text[])',
    [[...DEMO_USERNAMES]],
  );
  const weak: string[] = [];
  for (const row of found.rows) {
    if (await bcrypt.compare(DEMO_PASSWORD, row.password_hash)) weak.push(row.username);
  }
  return weak;
}

async function roleOf(db: AdminDb, username: string): Promise<string | undefined> {
  const found = await db.query<{ role: string }>('SELECT role FROM users WHERE username = $1', [username]);
  return found.rows[0]?.role;
}

/**
 * @returns `created` 表示这次插入；`exists` 表示已经是管理员，密码保持原样。
 */
export async function ensureProductionAdmin(db: AdminDb, admin: AdminIdentity): Promise<'created' | 'exists'> {
  const role = await roleOf(db, admin.username);
  if (role === 'admin') return 'exists';
  if (role) throw new Error(`ADMIN_USERNAME=${admin.username} 已被非管理员占用，不会把这个账号提权`);

  const emailTaken = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
    admin.email,
  ]);
  if (emailTaken.rows[0]) throw new Error('ADMIN_EMAIL 已被其他账号使用');

  const passwordHash = await bcrypt.hash(admin.password, 10);
  const id = `usr-${crypto.randomUUID()}`;
  try {
    await db.query(
      `INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, 'admin', true, now())`,
      [id, admin.username, passwordHash, admin.email, admin.username],
    );
  } catch (error: unknown) {
    if (pgCode(error) !== '23505') throw error;
    const winner = await roleOf(db, admin.username);
    if (winner === 'admin') return 'exists';
    throw new Error(
      winner ? `ADMIN_USERNAME=${admin.username} 已被非管理员占用，不会把这个账号提权` : 'ADMIN_EMAIL 已被其他账号使用',
    );
  }
  return 'created';
}
