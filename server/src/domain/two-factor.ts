/**
 * 两步验证的「第二因子」编排：邮箱验证码、验证器（TOTP）、备用码。
 *
 * 三者是**并列可用**的第二因子，登录时按「验证器 → 邮箱验证码 → 备用码」依次尝试：
 * - 验证器是日常方式（手机上算，不依赖网络与邮件）；
 * - 邮箱验证码是退路（换手机、验证器丢了但邮箱还在）；
 * - 备用码是最后一道（手机和邮箱都用不了时，用开启时抄下来的那批码）。
 * 让邮箱码与验证器共存并不削弱安全性：攻击者要拿到密码**加上**两者之一，
 * 而备用码是离线的一次性凭据，用完即废。
 *
 * 失败一律抛 `CodeRejected`（路由翻成 200 + `{ ok:false, error }`，与邮箱验证码一致），
 * 真正的基础设施故障继续上抛成 5xx。
 */

import crypto from 'node:crypto';
import auth = require('../config/auth');
import { query, transaction } from '../config/pool';
import { CodeRejected, isCodeRejected, consumeCode } from './otp';
import * as totp from './totp';

const { totpSecretKey } = auth;

function totpKey(): Buffer {
  return totp.encryptionKey(totpSecretKey);
}

interface FactorStateRow {
  email?: string | null;
  email_verified?: boolean | null;
  two_factor_enabled?: boolean | null;
  totp_secret?: string | null;
  backup_left?: number | null;
}

interface BackupCodeRow {
  id: string;
}

interface PendingSecretRow {
  totp_pending_secret?: string | null;
}

export interface SecondFactorUser {
  id: string;
  email?: string;
  username?: string;
  totp_secret?: string | null;
}

/**
 * 读某个用户当前可用的第二因子。
 *
 * `totpBound` 只表示「绑过验证器」，不代表开关打开；开关始终是 `two_factor_enabled`。
 */
export async function secondFactorState(userId: string): Promise<{
  enabled: boolean;
  totpBound: boolean;
  email: string;
  emailVerified: boolean;
  backupCodesLeft: number;
} | null> {
  const result = await query<FactorStateRow>(
    `
        SELECT u.email, u.email_verified, u.two_factor_enabled, u.totp_secret,
               (SELECT count(*)::int FROM backup_codes c
                 WHERE c.user_id = u.id AND c.used_at IS NULL) AS backup_left
          FROM users u
         WHERE u.id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const email = String(row.email || '');
  return {
    enabled: row.two_factor_enabled === true,
    totpBound: String(row.totp_secret || '') !== '',
    email,
    emailVerified: row.email_verified === true,
    backupCodesLeft: Number(row.backup_left) || 0,
  };
}

/** 解密已绑定的验证器密钥；密钥换过或数据坏了时给一句能照着做的话，而不是 500。 */
function openSecret(stored: string): string {
  try {
    return totp.decryptSecret(stored, totpKey());
  } catch {
    throw new CodeRejected('验证器密钥无法解读，请在「安全」里重新绑定验证器');
  }
}

/** 消费一枚备用码：命中即原子置为已用，并发提交两次只有一个能过。 */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const hash = totp.hashBackupCode(code);
  const found = await query<BackupCodeRow>(
    'SELECT id FROM backup_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
    [userId, hash],
  );
  const foundRow = found.rows[0];
  if (!foundRow) {
    return false;
  }
  const used = await query('UPDATE backup_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL', [foundRow.id]);
  return used.rowCount === 1;
}

/**
 * 生成一批备用码（**旧的全部作废**），返回明文列表 —— 只在这一刻能看到。
 *
 * 作废与写入放在同一个事务里：中途失败不会留下「旧码已删、新码没写」的账号 ——
 * 那等于把两步验证的最后一道退路悄悄拆掉。`unnest` 让 10 枚码只走一次往返，
 * 不再逐条 `await`（也不需要 `Promise.all` 那种「一半成功」的中间态）。
 */
export async function regenerateBackupCodes(userId: string, count = totp.BACKUP_CODE_COUNT): Promise<string[]> {
  const codes = totp.generateBackupCodes(count);
  const ids = codes.map(() => crypto.randomUUID());
  const hashes = codes.map((code) => totp.hashBackupCode(code));
  await transaction(async (client) => {
    await client.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
    await client.query(
      `
        INSERT INTO backup_codes (id, user_id, code_hash)
        SELECT id, $1, code_hash
          FROM unnest($2::text[], $3::text[]) AS t(id, code_hash)
      `,
      [userId, ids, hashes],
    );
  });
  return codes;
}

/** 清掉验证器绑定与备用码（关闭两步验证、或重新绑定时用）。 */
export async function clearSecondFactors(userId: string): Promise<void> {
  await query(
    `
        UPDATE users
           SET two_factor_enabled = false,
               totp_secret = '',
               totp_pending_secret = '',
               totp_confirmed_at = NULL,
               updated_at = now()
         WHERE id = $1
    `,
    [userId],
  );
  await query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
}

/**
 * 校验第二因子。
 *
 * @param user 至少要有 id 与 email。
 * @param code 用户输入的 6 位验证码或备用码。
 */
export async function verifySecondFactor(
  user: SecondFactorUser,
  code: unknown,
): Promise<{ method: 'totp' | 'email' | 'backup' }> {
  const value = String(code === undefined || code === null ? '' : code).trim();
  if (!value) {
    throw new CodeRejected('请输入验证码');
  }

  // 备用码的形状与 6 位码一眼可分：分开走分支，免得拿备用码去消耗邮箱验证码的尝试次数
  if (totp.isBackupCodeShape(value)) {
    if (!(await consumeBackupCode(user.id, value))) {
      throw new CodeRejected('备用码不正确或已被使用');
    }
    return { method: 'backup' };
  }

  if (!/^\d{6}$/.test(value)) {
    throw new CodeRejected('请输入 6 位数字验证码，或用「XXXXX-XXXXX」形式的备用码');
  }

  const stored = String(user.totp_secret || '');
  if (stored) {
    if (totp.verifyCode(openSecret(stored), value)) {
      return { method: 'totp' };
    }
  }

  try {
    const consumed = await consumeCode({
      purpose: 'login',
      email: user.email,
      code: value,
    });
    if (consumed.userId && consumed.userId !== user.id) {
      throw new CodeRejected('验证码不正确');
    }
    return { method: 'email' };
  } catch (error: unknown) {
    if (isCodeRejected(error)) {
      throw new CodeRejected(stored ? '验证码不正确（验证器与邮箱验证码都对不上）' : '验证码不正确');
    }
    throw error;
  }
}

/** 开始绑定验证器：密钥先放「待确认」列，确认过码之后才真正生效。 */
export async function beginTotpSetup(
  user: SecondFactorUser,
  issuer: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = totp.generateSecret();
  await query('UPDATE users SET totp_pending_secret = $2, updated_at = now() WHERE id = $1', [
    user.id,
    totp.encryptSecret(secret, totpKey()),
  ]);
  return {
    secret,
    otpauthUri: totp.otpauthUri({ secret, account: (user.email || user.username) as string, issuer }),
  };
}

/**
 * 确认绑定验证器：码要对得上「待确认」的密钥，成功后开关打开并生成第一批备用码。
 *
 * @returns 备用码的明文，只出现这一次。
 */
export async function confirmTotpSetup(userId: string, code: unknown): Promise<{ backupCodes: string[] }> {
  const found = await query<PendingSecretRow>('SELECT totp_pending_secret FROM users WHERE id = $1', [userId]);
  const pending = String((found.rows[0] || {}).totp_pending_secret || '');
  if (!pending) {
    throw new CodeRejected('请先生成验证器密钥');
  }
  const value = String(code === undefined || code === null ? '' : code).trim();
  if (!totp.verifyCode(openSecret(pending), value)) {
    throw new CodeRejected('验证码不正确，请确认手机时间准确、且扫的是刚生成的密钥');
  }
  await query(
    `
        UPDATE users
           SET totp_secret = totp_pending_secret,
               totp_pending_secret = '',
               totp_confirmed_at = now(),
               two_factor_enabled = true,
               updated_at = now()
         WHERE id = $1
    `,
    [userId],
  );
  return { backupCodes: await regenerateBackupCodes(userId) };
}
