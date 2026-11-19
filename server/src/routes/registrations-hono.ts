import crypto from 'node:crypto';
import { Hono } from 'hono';
import { query } from '../config/pool.js';
import { REGISTRATION_COLUMNS, REGISTRATION_FROM, EXHIBITION_COLUMNS, EXHIBITION_FROM } from '../domain/queries.js';
import { registrationPayload, type ExhibitionRow, type RegistrationRow } from '../domain/payloads.js';
import { loadFields } from './exhibitions-hono.js';
import { requireUser, assertNotLimited } from '../domain/permissions.js';
import { badRequest, forbidden } from '../domain/errors.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { authenticateHono, optionalAuthHono, userOf, type HonoEnv } from './hono-utils.js';
import * as labels from '../domain/labels.js';
import { limits as readLimits, parseSchema } from '../domain/validation.js';
import { answerDocument } from '../domain/answer-document.js';
import { registrationAttendance } from '../domain/registration-attendance.js';
import { guestRegistrationSchema, registrationSchema, registrationTargetSchema } from '../domain/schemas.js';

const app = new Hono<HonoEnv>();
const DUPLICATE_MESSAGE = '已提交过该展会的报名';
const QUERY_LINK_INVALID_MESSAGE = '查询链接无效或已失效';
const CLAIM_TAKEN_MESSAGE = '该报名已关联到其他账号';
/** 匿名报名：没有账号可认，提交后只发一条带随机凭据的查询链接。 */
const VISITOR_TYPE_GUEST = 'guest';

/**
 * 查询凭据：32 字节随机数的 base64url。链接里带明文，库里只存它的 sha256 十六进制。
 *
 * 与刷新令牌、身份复核票同一套做法：即使数据库泄露也拿不到可用的链接。明文只在
 * 创建报名的响应里返回一次，之后无法再取回（丢了就只能登录认领）。
 */
function newQueryToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function queryTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 按查询凭据取报名；凭据为空或形状不对时直接当无效，不查库。 */
async function loadRegistrationByToken(token: unknown): Promise<RegistrationRow | null> {
  const value = String(token ?? '').trim();
  if (!value || value.length > 128) return null;
  const result = await query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.query_token_hash = $1`,
    [queryTokenHash(value)],
  );
  return result.rows[0] || null;
}
/** 不可报名的原因：中文文案 + 稳定错误码。 */
function closedMessage(statusCode: string): { message: string; code: string } {
  if (statusCode === 'display') return { message: '该展会仅展示，不开放报名', code: 'registration.displayOnly' };
  if (statusCode === 'closed') return { message: '该展会已截止报名', code: 'registration.closed' };
  if (statusCode === 'ended') return { message: '该展会已结束', code: 'registration.ended' };
  return { message: '该展会当前不可报名', code: 'registration.unavailable' };
}
interface ExhibitionWindowRow extends ExhibitionRow {
  before_start: boolean;
  after_end: boolean;
}
async function loadExhibition(id: string) {
  const result = await query<ExhibitionWindowRow>(
    `SELECT ${EXHIBITION_COLUMNS}, (e.registration_start IS NOT NULL AND CURRENT_DATE < e.registration_start) AS before_start, (e.registration_end IS NOT NULL AND CURRENT_DATE > e.registration_end) AS after_end ${EXHIBITION_FROM} WHERE e.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}
async function loadRegistration(id: string) {
  const result = await query<RegistrationRow>(`SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.id = $1`, [
    id,
  ]);
  return result.rows[0] || null;
}
function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

app.get('/', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const result = await query<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} ${REGISTRATION_FROM} WHERE r.visitor_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [user.userId],
  );
  return jsonResponse(c, result.rows.map(registrationPayload));
});
app.get('/:id', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const row = await loadRegistration(c.req.param('id'));
  if (!row || (row.visitor_id !== user.userId && user.role !== 'admin'))
    return jsonResponse(c, { found: false, error: '报名记录不存在或已撤销', errorCode: 'registration.notFound' });
  return jsonResponse(c, { found: true, registration: registrationPayload(row) });
});
app.post('/', optionalAuthHono, async (c) => {
  // 报名站分享链接允许未登录报名；应用内的报名仍然带着登录态，走与以前完全相同的分支。
  const user = userOf(c);
  // 带着令牌却被判为无效（过期 / 已撤销）时**不能降级成匿名报名**：那会把应用内的报名
  // 悄悄写成一条没有账号的记录，用户在「我的活动」里永远看不到它。让前端按 401 去刷新
  // 访问令牌或重新登录，与改造前一致；只有完全不带令牌的请求才算匿名。
  if (!user && c.req.header('authorization')) requireUser({ user });
  if (user) assertNotLimited(user, 'register');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const { exhibitionId } = parseSchema(registrationTargetSchema, body);
    if (!exhibitionId) throw badRequest('请选择要报名的展会', { code: 'registration.exhibitionRequired' });
    const exhibition = await loadExhibition(exhibitionId);
    if (!exhibition) throw badRequest('展会不存在或已删除', { code: 'exhibition.notFound' });
    if (!labels.acceptsRegistration(exhibition.status)) {
      const closed = closedMessage(exhibition.status);
      throw badRequest(closed.message, { code: closed.code });
    }
    if (user) {
      // 登录报名才有「同一个人同一场展会只允许一条未撤销报名」这条规则：
      // 匿名报名的 visitor_id 为空，数据库的部分唯一索引也不会拦，这里更不能复用。
      const existing = await query(
        `SELECT id FROM registrations WHERE exhibition_id = $1 AND visitor_id = $2 AND status <> 'cancelled' LIMIT 1`,
        [exhibitionId, user.userId],
      );
      if (existing.rows.length > 0) throw badRequest(DUPLICATE_MESSAGE, { code: 'registration.duplicate' });
    }
    if (exhibition.before_start) throw badRequest('报名尚未开始', { code: 'registration.notStarted' });
    if (exhibition.after_end) throw badRequest('报名已截止', { code: 'registration.afterEnd' });
    const bounds = await readLimits();
    // 登录报名：姓名与身份取自账号（页面随提交带上）；匿名报名：只有姓名必填，身份记为访客。
    const input = user
      ? parseSchema(registrationSchema(), body)
      : { ...parseSchema(guestRegistrationSchema(bounds), body), visitorType: VISITOR_TYPE_GUEST };
    const { visitorName, visitorType, answers } = input;
    // 参加时间段：多天展会里用户自己选的日期。两端都空表示没选（按整段展会处理），
    // 只填一端 / 格式不对 / 超出展会区间都按规则失败；登录报名与匿名报名走同一段校验。
    const attendance = registrationAttendance(input, {
      date: exhibition.exhibition_date,
      endDate: exhibition.exhibition_end_date,
    });
    const document = answerDocument({
      fields: await loadFields(exhibitionId),
      source: { text: answers },
      limits: { textFill: Number(bounds.textFill) || 200, answer: Number(bounds.answer) || 200 },
    });
    if (document.message) throw badRequest(document.message, document.errorDetail);
    const autoApproved = exhibition.status === 'optional';
    const status = autoApproved ? 'approved' : 'pending';
    const id = `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    // 登录报名不生成查询凭据（空串不参与唯一索引）；匿名报名生成一条，明文只出现在这次响应里。
    const queryToken = user ? '' : newQueryToken();
    try {
      // 建记录时就生成核销凭据：报名码由「展会 + 报名 + 凭据」拼成，
      // 凭据以后可以在退回重审时轮换（见 routes/review-hono.ts）。
      await query(
        `INSERT INTO registrations (id, exhibition_id, visitor_id, visitor_name, visitor_type, answers, status, check_in_secret, query_token_hash, attendance_start, attendance_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          exhibitionId,
          user?.userId ?? null,
          visitorName,
          visitorType,
          document.text,
          status,
          labels.newCheckInSecret(),
          queryToken ? queryTokenHash(queryToken) : '',
          attendance?.start ?? null,
          attendance?.end ?? null,
        ],
      );
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        throw badRequest(DUPLICATE_MESSAGE, { code: 'registration.duplicate' });
      throw error;
    }
    const created = await loadRegistration(id);
    return {
      autoApproved,
      statusLabel: labels.REGISTRATION_STATUS[status],
      registration: registrationPayload(created!),
      // 匿名报名的凭据只给一次：页面立刻把它放进状态页链接，并提示用户保存。
      ...(queryToken ? { queryToken } : {}),
    };
  });
});
app.get('/query/:token', async (c) => {
  // 公开读：凭据本身就是身份。无效凭据与「查不到」同形返回，不区分「格式错」和「不存在」。
  const row = await loadRegistrationByToken(c.req.param('token'));
  if (!row)
    return jsonResponse(c, {
      found: false,
      error: QUERY_LINK_INVALID_MESSAGE,
      errorCode: 'registration.queryLinkInvalid',
    });
  // 与 `GET /:id` 同形，页面共用一套渲染；匿名报名人要靠这里拿到自己的报名码。
  return jsonResponse(c, { found: true, registration: registrationPayload(row) });
});
app.post('/claim', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) }, '请先登录后再操作', { code: 'registration.loginRequired' });
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    // 认领不新建报名，因此不受「受限账号不能报名」限制：只是把已有的匿名报名并进账号，
    // 之后能在「我的活动」里查看、撤销（受限账号本来就可以撤销自己的报名）。
    const row = await loadRegistrationByToken(body.token);
    if (!row) throw badRequest(QUERY_LINK_INVALID_MESSAGE, { code: 'registration.queryLinkInvalid' });
    if (row.visitor_id === user.userId) {
      // 重复认领是幂等成功：用户可能只是又打开了一次保存的链接。
      return { claimed: false, registration: registrationPayload(row) };
    }
    if (row.visitor_id) throw badRequest(CLAIM_TAKEN_MESSAGE, { code: 'registration.claimTaken' });
    try {
      // 条件更新兜住并发：另一个账号刚认领走时 rowCount 为 0，按「已被关联」处理。
      // 姓名保留匿名报名时填的那一份，不改成账号昵称（那是报名人自己写的）。
      const updated = await query(
        `UPDATE registrations SET visitor_id = $2, updated_at = now() WHERE id = $1 AND visitor_id IS NULL`,
        [row.id, user.userId],
      );
      if (updated.rowCount !== 1) throw badRequest(CLAIM_TAKEN_MESSAGE, { code: 'registration.claimTaken' });
    } catch (error: unknown) {
      // 与账号在本展会的另一条未撤销报名冲突（唯一部分索引）：与登录报名同一句文案。
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505')
        throw badRequest(DUPLICATE_MESSAGE, { code: 'registration.duplicate' });
      throw error;
    }
    const claimed = await loadRegistration(row.id);
    return { claimed: true, registration: registrationPayload(claimed!) };
  });
});
app.delete('/:id', authenticateHono, async (c) =>
  mutate(c, async () => {
    const user = requireUser({ user: userOf(c) }, '请先登录后再操作', { code: 'registration.loginRequired' });
    const result = await query<{ id: string; visitor_id: string | null; status: string; allow_cancel: boolean }>(
      `SELECT r.id, r.visitor_id, r.status, e.allow_cancel
         FROM registrations r
         JOIN exhibitions e ON e.id = r.exhibition_id
        WHERE r.id = $1`,
      [c.req.param('id')],
    );
    const row = result.rows[0];
    if (!row) throw badRequest('报名记录不存在或已撤销', { code: 'registration.notFound' });
    if (row.visitor_id !== user.userId) throw forbidden('只能撤销自己的报名', { code: 'registration.cancelNotYours' });
    if (row.status === 'cancelled')
      throw badRequest('该报名已撤销，无需重复操作', { code: 'registration.alreadyCancelled' });
    if (row.status === 'attended')
      throw badRequest('已参加的报名不能再撤销', { code: 'registration.attendedCannotCancel' });
    if (row.status === 'approved' && row.allow_cancel !== true)
      throw badRequest('展商未允许撤销已通过的报名', { code: 'registration.cancelNotAllowed' });
    await query(`UPDATE registrations SET status = 'cancelled', updated_at = now() WHERE id = $1`, [row.id]);
    return {};
  }),
);

export function createRegistrationsRoutes() {
  return app;
}
export const REGISTRATION_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/'],
  ['GET', '/:id'],
  // 公开的查询链接：凭据在路径里（`/query/<token>`），接口自己按哈希匹配报名。
  ['GET', '/query/:token'],
  ['POST', '/'],
  ['POST', '/claim'],
  ['DELETE', '/:id'],
];
