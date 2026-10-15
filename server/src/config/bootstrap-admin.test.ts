/**
 * 生产管理员只创建一次，并且会认出仍使用示例口令的演示账号。
 */

import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { demoAccountsUsingExamplePassword, ensureProductionAdmin, type AdminDb } from './bootstrap-admin.js';

interface Row {
  id: string;
  username: string;
  role: string;
  email: string;
  password_hash: string;
}

const admin = { username: 'opsadmin', password: 'correct-horse-battery', email: 'ops@mail.example.com' };

function memoryDb(initial: Row[] = []): AdminDb & { rows: Row[] } {
  const rows = initial.map((row) => ({ ...row }));
  return {
    rows,
    async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (text.startsWith('SELECT username, password_hash')) {
        const names = params[0] as string[];
        return { rows: rows.filter((row) => names.includes(row.username)) as T[] };
      }
      if (text.startsWith('SELECT role FROM users WHERE username')) {
        const found = rows.find((row) => row.username === params[0]);
        return { rows: (found ? [{ role: found.role }] : []) as T[] };
      }
      if (text.startsWith('SELECT id FROM users WHERE lower(email)')) {
        const found = rows.find((row) => row.email.toLowerCase() === String(params[0]).toLowerCase());
        return { rows: (found ? [{ id: found.id }] : []) as T[] };
      }
      if (text.startsWith('INSERT INTO users')) {
        const id = String(params[0]);
        const username = String(params[1]);
        const passwordHash = String(params[2]);
        const email = String(params[3]);
        if (rows.some((row) => row.username === username || row.email.toLowerCase() === email.toLowerCase())) {
          const error = new Error('duplicate') as Error & { code: string };
          error.code = '23505';
          throw error;
        }
        rows.push({ id, username, role: 'admin', email, password_hash: passwordHash });
        return { rows: [] };
      }
      throw new Error(`未预期的语句：${text}`);
    },
  };
}

test('没有管理员时创建，已有管理员时不改密码', async () => {
  const db = memoryDb();
  assert.equal(await ensureProductionAdmin(db, admin), 'created');
  const created = db.rows[0];
  assert.equal(created?.role, 'admin');
  assert.equal(created?.email, admin.email);
  assert.equal(await bcrypt.compare(admin.password, created?.password_hash || ''), true);
  const previous = created?.password_hash;
  assert.equal(await ensureProductionAdmin(db, { ...admin, password: 'another-admin-secret' }), 'exists');
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0]?.password_hash, previous);
});

test('用户名或邮箱被别人占用时不提权', async () => {
  const takenName = memoryDb([
    { id: 'usr-1', username: 'opsadmin', role: 'user', email: 'other@mail.example.com', password_hash: 'x' },
  ]);
  await assert.rejects(() => ensureProductionAdmin(takenName, admin), /不会把这个账号提权/);

  const takenEmail = memoryDb([
    { id: 'usr-2', username: 'someone', role: 'user', email: 'ops@mail.example.com', password_hash: 'x' },
  ]);
  await assert.rejects(() => ensureProductionAdmin(takenEmail, admin), /ADMIN_EMAIL 已被其他账号使用/);
});

test('并发插入撞上唯一约束时，胜出的管理员算已存在', async () => {
  const db = memoryDb();
  const original = db.query.bind(db);
  const query: AdminDb['query'] = async (text, params) => {
    if (text.startsWith('INSERT INTO users')) {
      db.rows.push({
        id: 'usr-winner',
        username: admin.username,
        role: 'admin',
        email: admin.email,
        password_hash: 'kept',
      });
      const error = new Error('duplicate') as Error & { code: string };
      error.code = '23505';
      throw error;
    }
    return original(text, params);
  };
  db.query = query;
  assert.equal(await ensureProductionAdmin(db, admin), 'exists');
  assert.equal(db.rows[0]?.password_hash, 'kept');
});

test('只把仍使用示例口令的演示账号报出来', async () => {
  const weak = await bcrypt.hash('password', 4);
  const strong = await bcrypt.hash('correct-horse-battery', 4);
  const db = memoryDb([
    { id: 'usr-1', username: 'demo', role: 'admin', email: 'demo@example.com', password_hash: weak },
    { id: 'usr-2', username: 'user', role: 'user', email: 'user@example.com', password_hash: strong },
  ]);
  assert.deepEqual(await demoAccountsUsingExamplePassword(db), ['demo']);
});
