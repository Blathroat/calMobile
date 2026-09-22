/**
 * profile：资料读写、改密码、通知偏好。
 *
 * 响应约定（见 index.js 头部注释）：
 * - 读取接口直接返回数据本身：`GET /` 给用户态、`GET /notifications` 给通知偏好；
 * - 写入接口走 `mutate()` 信封 `{ ok, error, ... }`，校验失败是**业务失败**（HTTP 200）
 *   + `{ ok:false, error }`，页面 `if (!result.ok)` 就地提示；
 * - 未登录由 `authenticate` 给 401，前端 api.js 当作异常抛出。
 *
 * 保存资料只写**请求体里出现过的字段**：个人页保存配色或隐私开关时，
 * 不能顺带把昵称、简介或另一个开关改回默认值。
 */

import express = require('express');
const bcrypt = require('bcryptjs') as {
  hash(data: string, saltOrRounds: number): Promise<string>;
  hashSync(data: string, saltOrRounds: number): string;
  compare(data: string, encrypted: string): Promise<boolean>;
};
import { query } from '../config/pool';
import { USER_COLUMNS, USER_FROM } from '../domain/queries';
import { userPayload, type UserRow } from '../domain/payloads';
import { capabilities, assertNotLimited } from '../domain/permissions';
import { limits, bool } from '../domain/validation';
import { mutate } from '../domain/respond';
import { badRequest, notFound } from '../domain/errors';
import { issueCode, consumeCode, isCodeRejected, maskEmail } from '../domain/otp';
import {
  secondFactorState,
  beginTotpSetup,
  confirmTotpSetup,
  regenerateBackupCodes,
  clearSecondFactors,
} from '../domain/two-factor';
import { readNotificationPreferences, saveNotificationPreferences, readServerSettings } from '../domain/settings';
import { revokeAllForUser } from '../domain/session';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/** 邮箱格式与 auth.js 的注册校验保持一致。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PasswordHashRow {
  password_hash: string;
}

interface PasswordFactorRow {
  password_hash: string;
  two_factor_enabled?: boolean | null;
}

interface VerifiedAtRow {
  email_verified_at?: string | Date | null;
}

interface FactorToggleRow {
  email: string;
  email_verified?: boolean | null;
  two_factor_enabled?: boolean | null;
}

interface EmailOnlyRow {
  email: string;
}

interface TotpAccountRow {
  id: string;
  username: string;
  email: string;
}

/** 请求体里是否真的带了某个字段（`{bio: ''}` 与「没传」是两件事）。 */
function has(body: object | null | undefined, key: string) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

/** 读取一个用户行并拼成前端要的用户态（页面直接拿它刷新界面）。 */
async function loadUser(id: string) {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`, [id]);
  if (result.rows.length === 0) {
    throw notFound('用户不存在或已删除');
  }
  const row = result.rows[0];
  if (!row) {
    throw notFound('用户不存在或已删除');
  }
  return userPayload(row, capabilities(row.role, row.status as string | undefined));
}

/**
 * GET /api/v1/profile
 * 当前登录用户的资料，返回的就是页面使用的用户态对象。
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    res.json(await loadUser(req.user!.userId));
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * PUT /api/v1/profile
 * 保存资料：`nickname / email / bio / region / socialMedia / avatar / showRegistrations`，
 * 只更新出现过的字段（隐私开关此前没有落库，这里真的写 `users.show_registrations`）。
 *
 * 受限账号（管理员不受限）不能改个人信息 → 403；判定放在 `mutate()` 外面，
 * 前端才拿得到状态码。改密码与通知偏好是另外两条路由，不受这条限制。
 */
router.put('/', authenticate, async (req, res, next) => {
  try {
    assertNotLimited(req.user, 'profile');
  } catch (error: unknown) {
    next(error);
    return;
  }
  try {
    await mutate(res, next, async () => {
      const body = req.body || {};
      const bounds = await limits();
      const assignments: string[] = [];
      const values: unknown[] = [];
      /** 追加一列赋值，参数按顺序占位，SQL 全程参数化。 */
      const set = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (has(body, 'nickname')) {
        const nickname = String(body.nickname === undefined ? '' : body.nickname).trim();
        if (!nickname) {
          throw badRequest('昵称不能为空');
        }
        if (bounds.nickname && nickname.length > bounds.nickname) {
          throw badRequest(`昵称最多 ${bounds.nickname} 个字符`);
        }
        set('nickname', nickname);
      }
      if (has(body, 'email')) {
        // 邮箱**不能**在这里直接改：它是找回密码与两步验证的凭据，必须走
        // `POST /profile/email` + `/profile/email/verify`（码发到新地址、通过才落库）。
        // 否则「偷到会话 → 改邮箱 → 找回密码」就是一条完整的账号接管链。
        throw badRequest('邮箱需要通过「验证新邮箱」修改');
      }
      if (has(body, 'bio')) {
        const bio = String(body.bio === undefined ? '' : body.bio).trim();
        if (bounds.bio && bio.length > bounds.bio) {
          throw badRequest(`个人简介最多 ${bounds.bio} 个字符`);
        }
        set('bio', bio);
      }
      if (has(body, 'region')) {
        const region = String(body.region === undefined ? '' : body.region).trim();
        if (bounds.region && region.length > bounds.region) {
          throw badRequest(`地区最多 ${bounds.region} 个字符`);
        }
        set('region', region);
      }
      if (has(body, 'socialMedia')) {
        set('social_media', String(body.socialMedia === undefined ? '' : body.socialMedia).trim());
      }
      if (has(body, 'avatar')) {
        set('avatar', String(body.avatar === undefined ? '' : body.avatar).trim());
      }
      if (has(body, 'showRegistrations')) {
        set('show_registrations', bool(body.showRegistrations, false));
      }

      if (assignments.length > 0) {
        values.push(req.user!.userId);
        await query(
          `
                    UPDATE users SET ${assignments.join(', ')}, updated_at = now()
                    WHERE id = $${values.length}
                `,
          values,
        );
      }
      return { user: await loadUser(req.user!.userId) };
    });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/password
 * 改密码：先校验输入与当前密码，再落新哈希，最后撤销该用户全部刷新令牌
 * （其它设备上的旧刷新令牌从此换不到访问令牌）。
 */
router.post('/password', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => {
      const body = req.body || {};
      const current = String(body.currentPassword === undefined ? '' : body.currentPassword);
      const nextPassword = String(body.newPassword === undefined ? '' : body.newPassword);
      const confirm = String(body.confirmPassword === undefined ? '' : body.confirmPassword);

      if (!current || !nextPassword) {
        throw badRequest('请填写完整密码');
      }
      if (nextPassword !== confirm) {
        throw badRequest('两次输入的新密码不一致');
      }
      const bounds = await limits();
      if (bounds.passwordMin && nextPassword.length < bounds.passwordMin) {
        throw badRequest(`密码至少需要 ${bounds.passwordMin} 个字符`);
      }
      if (bounds.passwordMax && nextPassword.length > bounds.passwordMax) {
        throw badRequest(`密码最多 ${bounds.passwordMax} 个字符`);
      }

      const found = await query<PasswordHashRow>('SELECT password_hash FROM users WHERE id = $1', [req.user!.userId]);
      const row = found.rows[0];
      const matched = row && (await bcrypt.compare(current, row.password_hash));
      if (!matched) {
        throw badRequest('当前密码不正确');
      }

      await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        req.user!.userId,
        await bcrypt.hash(nextPassword, 10),
      ]);
      await revokeAllForUser(req.user!.userId);
      return {};
    });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * GET /api/v1/profile/security
 * 安全设置：邮箱与验证状态、两步验证开关。
 *
 * `canEnable` 由后端算：两步验证只支持邮箱方式，没有已验证邮箱就不该让前端把开关点亮。
 */
router.get('/security', authenticate, async (req, res, next) => {
  try {
    const factors = await secondFactorState(req.user!.userId);
    if (!factors) {
      throw notFound('用户不存在或已删除');
    }
    res.json({
      email: factors.email,
      emailVerified: factors.emailVerified,
      emailVerifiedAt: await verifiedAt(req.user!.userId),
      twoFactorEnabled: factors.enabled,
      // 绑定过验证器 ≠ 开关打开；这两个字段分开，页面才画得对
      totpEnabled: factors.totpBound,
      backupCodesLeft: factors.backupCodesLeft,
      // 两步验证只支持邮箱方式：没有已验证邮箱就不该让开关亮起来
      canEnable: factors.emailVerified && factors.email !== '',
    });
  } catch (error: unknown) {
    next(error);
  }
});

/** 邮箱验证时间（`secondFactorState` 不带它，这里单独取一次，只用于展示）。 */
async function verifiedAt(userId: string) {
  const result = await query<VerifiedAtRow>('SELECT email_verified_at FROM users WHERE id = $1', [userId]);
  const row = result.rows[0];
  return row && row.email_verified_at ? new Date(row.email_verified_at).toISOString() : '';
}

/**
 * POST /api/v1/profile/2fa/enable
 * 开启两步验证第一步：把验证码发到已验证邮箱。
 *
 * 开启也要求过码（而不只是按一下开关）：这既是「证明这个邮箱现在真的能收到信」，
 * 也避免用户随手打开、然后在下一次登录时发现自己收不到码而进不去。
 */
router.post('/2fa/enable', authenticate, async (req, res, next) => {
  try {
    const found = await query<FactorToggleRow>(
      'SELECT email, email_verified, two_factor_enabled FROM users WHERE id = $1',
      [req.user!.userId],
    );
    const row = found.rows[0];
    if (!row) {
      throw notFound('用户不存在或已删除');
    }
    if (row.two_factor_enabled === true) {
      res.json({ ok: true, error: '', alreadyEnabled: true });
      return;
    }
    if (row.email_verified !== true || !row.email) {
      throw badRequest('请先验证邮箱，再开启两步验证');
    }
    const sent = await issueCode({
      purpose: 'enable2fa',
      email: row.email,
      userId: req.user!.userId,
      ip: req.ip || '',
    });
    res.json({ ok: true, error: '', ...sent, maskedEmail: maskEmail(row.email) });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/2fa/enable/verify
 * 开启两步验证第二步：验证码通过才真的打开开关。
 */
router.post('/2fa/enable/verify', authenticate, async (req, res, next) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    const found = await query<EmailOnlyRow>('SELECT email FROM users WHERE id = $1', [req.user!.userId]);
    if (found.rows.length === 0) {
      throw notFound('用户不存在或已删除');
    }
    const emailRow = found.rows[0];
    if (!emailRow) {
      throw notFound('用户不存在或已删除');
    }
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'enable2fa', email: emailRow.email, code });
    } catch (error: unknown) {
      if (isCodeRejected(error)) {
        res.json({ ok: false, error: error.message });
        return;
      }
      throw error;
    }
    // 这枚码必须是为当前账号签发的（邮箱可能在这期间被改过）
    if (consumed.userId !== req.user!.userId) {
      res.json({ ok: false, error: '验证码不正确或已失效' });
      return;
    }
    await query('UPDATE users SET two_factor_enabled = true, updated_at = now() WHERE id = $1', [req.user!.userId]);
    // 开启成功就给一批备用码：它和「用哪种方式验证」无关，是手机与邮箱都用不了时的最后一道
    res.json({
      ok: true,
      error: '',
      twoFactorEnabled: true,
      backupCodes: await regenerateBackupCodes(req.user!.userId),
    });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/2fa/totp/setup
 * 绑定验证器第一步：生成密钥，返回 base32 密钥与 `otpauth://` 二维码地址。
 *
 * **这一步不改开关**：密钥先落在 `totp_pending_secret`，只有用户输对一次验证码
 * （`/2fa/totp/enable`）才算绑定成功 —— 否则扫了个没成功的码就把自己锁在门外。
 */
router.post('/2fa/totp/setup', authenticate, async (req, res, next) => {
  try {
    const found = await query<TotpAccountRow>('SELECT id, username, email FROM users WHERE id = $1', [
      req.user!.userId,
    ]);
    const user = found.rows[0];
    if (!user) {
      throw notFound('用户不存在或已删除');
    }
    const settings = await readServerSettings();
    const issuer = String((settings.brand && (settings.brand.zh || settings.brand.en)) || 'calMobile');
    const setup = await beginTotpSetup({ id: user.id, username: user.username, email: user.email }, issuer);
    res.json({ ok: true, error: '', issuer, ...setup });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/2fa/totp/enable
 * 绑定验证器第二步：验证码对得上刚生成的密钥 → 正式绑定、打开开关、发一批备用码。
 */
router.post('/2fa/totp/enable', authenticate, async (req, res, next) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    const result = await confirmTotpSetup(req.user!.userId, code);
    res.json({ ok: true, error: '', twoFactorEnabled: true, ...result });
  } catch (error: unknown) {
    if (isCodeRejected(error)) {
      res.json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * POST /api/v1/profile/2fa/backup-codes
 * 重新生成备用码（旧的一次性码全部作废）。要当前密码：会话被偷不该能重置恢复凭据。
 *
 * 返回的明文列表**只出现这一次**，库里只有 sha256。
 */
router.post('/2fa/backup-codes', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => {
      const password = String((req.body || {}).password || '');
      if (!password) {
        throw badRequest('请输入当前密码');
      }
      const found = await query<PasswordFactorRow>(
        'SELECT password_hash, two_factor_enabled FROM users WHERE id = $1',
        [req.user!.userId],
      );
      const row = found.rows[0];
      const matched = row && (await bcrypt.compare(password, row.password_hash));
      if (!matched) {
        throw badRequest('当前密码不正确');
      }
      if (row.two_factor_enabled !== true) {
        throw badRequest('请先开启两步验证，再生成备用码');
      }
      return { backupCodes: await regenerateBackupCodes(req.user!.userId) };
    });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/2fa/disable
 * 关闭两步验证：要当前密码（拿到会话还不够，否则会话被偷就等于能关掉第二道锁）。
 */
router.post('/2fa/disable', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => {
      const password = String((req.body || {}).password || '');
      if (!password) {
        throw badRequest('请输入当前密码');
      }
      const found = await query<PasswordHashRow>('SELECT password_hash FROM users WHERE id = $1', [req.user!.userId]);
      const row = found.rows[0];
      const matched = row && (await bcrypt.compare(password, row.password_hash));
      if (!matched) {
        throw badRequest('当前密码不正确');
      }
      // 关闭要把验证器绑定与备用码一起清掉：只翻开关的话，下次开启会静默沿用旧密钥与旧备用码。
      await clearSecondFactors(req.user!.userId);
      return { twoFactorEnabled: false };
    });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/email
 * 改邮箱第一步：把验证码发到**新**地址。
 *
 * 「先验证新地址、通过后才落库」有两个好处：账号永远处于「邮箱已验证」的状态，
 * 不需要再为「未验证」设计一套功能限制；也不存在「改成别人的邮箱」这种接管路径。
 */
router.post('/email', authenticate, async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 120) {
      throw badRequest('邮箱格式不正确');
    }
    const current = await query<EmailOnlyRow>('SELECT email FROM users WHERE id = $1', [req.user!.userId]);
    const currentRow = current.rows[0];
    if (String(currentRow ? currentRow.email : '').toLowerCase() === email.toLowerCase()) {
      throw badRequest('新邮箱与当前邮箱相同');
    }
    const taken = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken.rows.length > 0) {
      res.json({ ok: false, error: '该邮箱已被其他账号使用' });
      return;
    }
    const sent = await issueCode({
      purpose: 'email',
      email,
      userId: req.user!.userId,
      ip: req.ip || '',
    });
    res.json({ ok: true, error: '', ...sent });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/v1/profile/email/verify
 * 改邮箱第二步：验证码通过才把新地址写进账号。
 */
router.post('/email/verify', authenticate, async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim();
    const code = String((req.body || {}).code || '').trim();
    let consumed;
    try {
      consumed = await consumeCode({ purpose: 'email', email, code });
    } catch (error: unknown) {
      if (isCodeRejected(error)) {
        res.json({ ok: false, error: error.message });
        return;
      }
      throw error;
    }
    // 这枚码必须是为**当前登录用户**签发的，否则别人用自己账号发的改邮箱码也能拿来改你的账号
    if (consumed.userId !== req.user!.userId) {
      res.json({ ok: false, error: '验证码不正确或已失效' });
      return;
    }
    try {
      await query(
        `
                UPDATE users
                   SET email = $2, email_verified = true, email_verified_at = now(), updated_at = now()
                 WHERE id = $1
            `,
        [req.user!.userId, consumed.email],
      );
    } catch (error: unknown) {
      // 唯一索引冲突：这期间被别的账号占用了
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
        res.json({ ok: false, error: '该邮箱已被其他账号使用' });
        return;
      }
      throw error;
    }
    res.json({ ok: true, error: '', user: await loadUser(req.user!.userId) });
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * GET /api/v1/profile/notifications
 * 通知偏好（个人页的两个开关）。设备通知权限由客户端自己确认，
 * 后端只保存用户的开关，因此 `granted` 恒为 true，不代表系统权限已授予。
 */
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    res.json(await readNotificationPreferences(req.user!.userId));
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * PUT /api/v1/profile/notifications
 * 保存通知偏好：可以只提交一个开关，未提交的保持不变。
 */
router.put('/notifications', authenticate, async (req, res, next) => {
  try {
    await mutate(res, next, async () => ({
      notify: await saveNotificationPreferences(req.user!.userId, req.body || {}),
    }));
  } catch (error: unknown) {
    next(error);
  }
});

export = router;
