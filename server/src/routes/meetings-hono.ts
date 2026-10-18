import { Hono } from 'hono';
import type { PoolClient } from 'pg';
import { query, transaction } from '../config/pool.js';
import { fieldPayload, type FieldRow } from '../domain/payloads.js';
import { assertNotLimited, canHostMeetings, requireUser } from '../domain/permissions.js';
import { badRequest, forbidden, notFound } from '../domain/errors.js';
import { jsonResponse, mutate } from '../http/respond.js';
import { readJsonBody } from '../http/body-limit.js';
import { authenticateHono, userOf, type HonoEnv } from './hono-utils.js';
import * as labels from '../domain/labels.js';
import { limits as readLimits, parseSchema } from '../domain/validation.js';
import { boolSchema } from '../domain/validation.js';
import { z } from 'zod';
import { answerDocument } from '../domain/answer-document.js';
import { meetingApplySchema, meetingSettingsSchema } from '../domain/schemas.js';
import { readSection } from '../domain/settings.js';

const app = new Hono<HonoEnv>();
const CLOSED_MESSAGE = '展商暂不接受会议预约';
const DUPLICATE_MESSAGE = '这一天已经向该展商提交过会议申请';
const LOCKED_MESSAGE = '该会议已被管理员限制，不能修改';

interface ExhibitorGate {
  id: string;
  role: string;
  status: string;
  accept_meetings: boolean;
  /** 限时展商的到期时间；NULL 表示永久。到期后不再接受新的会议预约。 */
  exhibitor_expires_at?: string | Date | null;
  meeting_allow_cancel?: boolean | null;
  meeting_notice?: string | null;
  nickname: string;
}

interface MeetingRow {
  id: string;
  exhibitor_id: string;
  visitor_id: string | null;
  visitor_name: string;
  meeting_date: string;
  meeting_time: string;
  answers: string;
  status: string;
  locked: boolean;
  created_at: string | Date;
  exhibitor_name?: string | null;
  exhibitor_role?: string | null;
  visitor_role?: string | null;
  allow_cancel?: boolean | null;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function meetingPayload(row: MeetingRow) {
  const statusCode = row.status;
  return {
    id: row.id,
    exhibitorId: row.exhibitor_id,
    exhibitorName: row.exhibitor_name || '',
    exhibitorRole: row.exhibitor_role || '',
    visitorId: row.visitor_id || '',
    visitorName: row.visitor_name,
    visitorRole: row.visitor_role || '',
    meetingDate: row.meeting_date,
    meetingTime: row.meeting_time || '',
    answers: row.answers || '',
    status: labels.REGISTRATION_STATUS[statusCode] || '',
    statusCode,
    locked: row.locked === true,
    allowCancel: row.allow_cancel === true,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}

const MEETING_SELECT = `
  m.id, m.exhibitor_id, m.visitor_id, m.visitor_name, m.meeting_time, m.answers, m.status, m.locked, m.created_at,
  to_char(m.meeting_date, 'YYYY-MM-DD') AS meeting_date,
  COALESCE(eu.nickname, '') AS exhibitor_name,
  COALESCE(eu.role, '') AS exhibitor_role,
  COALESCE(vu.role, '') AS visitor_role,
  eu.meeting_allow_cancel AS allow_cancel
`;

const MEETING_FROM = `
  FROM private_meetings m
  JOIN users eu ON eu.id = m.exhibitor_id
  LEFT JOIN users vu ON vu.id = m.visitor_id
`;

async function loadFields(exhibitorId: string) {
  const result = await query<FieldRow>(
    `SELECT id, title, type, required, options FROM meeting_fields
      WHERE exhibitor_id = $1 ORDER BY position, id`,
    [exhibitorId],
  );
  return result.rows.map(fieldPayload);
}

async function replaceFields(
  client: PoolClient,
  exhibitorId: string,
  fields: { title: string; type: string; required: boolean; options: string[] }[],
) {
  await client.query('DELETE FROM meeting_fields WHERE exhibitor_id = $1', [exhibitorId]);
  for (const [index, item] of fields.entries()) {
    await client.query(
      `INSERT INTO meeting_fields (id, exhibitor_id, title, type, required, options, position)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [newId('mfield'), exhibitorId, item.title, item.type, item.required, JSON.stringify(item.options), index],
    );
  }
}

function assertTime(value: string) {
  if (!value) return;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw badRequest('会议时间需要是 HH:MM');
}

/** 正常的展商或管理员，且自己打开了开关，才接受新申请。受限、封禁与到期一律视为关闭。 */
function meetingsOpen(row: ExhibitorGate): boolean {
  return canHostMeetings(row.role, row.exhibitor_expires_at) && row.status === 'active' && row.accept_meetings === true;
}

async function loadMeeting(id: string) {
  const result = await query<MeetingRow>(`SELECT ${MEETING_SELECT} ${MEETING_FROM} WHERE m.id = $1`, [id]);
  return result.rows[0] || null;
}

app.get('/settings', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  if (user.role !== 'exhibitor' && user.role !== 'admin') throw forbidden('只有展商或管理员可以执行此操作');
  const row = await query<ExhibitorGate>(
    'SELECT id, role, status, accept_meetings, meeting_allow_cancel, meeting_notice, nickname, exhibitor_expires_at FROM users WHERE id = $1',
    [user.userId],
  );
  const exhibitor = row.rows[0];
  if (!exhibitor) throw notFound('用户不存在或已删除');
  const forcedOff = exhibitor.status === 'limited' || exhibitor.status === 'banned';
  return jsonResponse(c, {
    acceptMeetings: forcedOff ? false : exhibitor.accept_meetings === true,
    allowCancel: exhibitor.meeting_allow_cancel === true,
    notice: exhibitor.meeting_notice || '',
    forcedOff,
    fields: await loadFields(user.userId),
  });
});

app.put('/settings', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  if (user.role !== 'exhibitor' && user.role !== 'admin') throw forbidden('只有展商或管理员可以执行此操作');
  assertNotLimited(user, 'meetingSettings');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const input = parseSchema(meetingSettingsSchema(await readLimits()), body);
    const row = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [user.userId]);
    const status = row.rows[0]?.status || '';
    const forcedOff = status === 'limited' || status === 'banned';
    if (forcedOff) throw forbidden('账号已被限制，不能接受会议预约');
    const accept = input.acceptMeetings === true && !forcedOff;
    await transaction(async (client) => {
      await client.query(
        `UPDATE users
            SET accept_meetings = $2, meeting_allow_cancel = $3, meeting_notice = $4, updated_at = now()
          WHERE id = $1`,
        [user.userId, accept, input.allowCancel === true, input.notice],
      );
      await replaceFields(client, user.userId, input.fields);
    });
    return {
      acceptMeetings: accept,
      allowCancel: input.allowCancel === true,
      notice: input.notice,
      fields: await loadFields(user.userId),
    };
  });
});

app.get('/mine', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const result = await query<MeetingRow>(
    `SELECT ${MEETING_SELECT}
       ${MEETING_FROM}
      WHERE m.visitor_id = $1
      ORDER BY m.meeting_date DESC, m.created_at DESC, m.id DESC`,
    [user.userId],
  );
  return jsonResponse(c, result.rows.map(meetingPayload));
});

app.get('/inbox', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const requested = String(c.req.query('exhibitorId') || '').trim();
  if (!canHostMeetings(user.role)) throw forbidden('只有展商或管理员可以执行此操作');
  // 没指定主办人时看自己的收件箱。管理员可以点名另一位展商或管理员。
  const exhibitorId = requested || user.userId;
  if (user.role === 'exhibitor' && exhibitorId !== user.userId) throw forbidden('只能查看自己的私人会议');
  const exhibitor = await query<ExhibitorGate>(
    'SELECT id, nickname, role, status, accept_meetings, exhibitor_expires_at FROM users WHERE id = $1',
    [exhibitorId],
  );
  const row = exhibitor.rows[0];
  if (!row) throw notFound('用户不存在或已删除');
  if (!canHostMeetings(row.role, row.exhibitor_expires_at)) throw badRequest('该用户不是展商');
  const result = await query<MeetingRow>(
    `SELECT ${MEETING_SELECT}
       ${MEETING_FROM}
      WHERE m.exhibitor_id = $1
      ORDER BY m.created_at DESC, m.id DESC`,
    [exhibitorId],
  );
  return jsonResponse(c, {
    exhibitorId,
    exhibitorName: row.nickname,
    records: result.rows.map(meetingPayload),
  });
});

app.get('/apply/:exhibitorId', authenticateHono, async (c) => {
  requireUser({ user: userOf(c) });
  const exhibitorId = c.req.param('exhibitorId');
  const result = await query<ExhibitorGate>(
    'SELECT id, role, status, accept_meetings, meeting_allow_cancel, meeting_notice, nickname, exhibitor_expires_at FROM users WHERE id = $1',
    [exhibitorId],
  );
  const exhibitor = result.rows[0];
  if (!exhibitor) return jsonResponse(c, { found: false, error: '用户不存在或已删除' });
  const viewer = userOf(c);
  const self = viewer?.userId === exhibitor.id;
  const open = !self && meetingsOpen(exhibitor);
  return jsonResponse(c, {
    found: true,
    open,
    self,
    exhibitorId: exhibitor.id,
    exhibitorName: exhibitor.nickname,
    roleCode: exhibitor.role,
    notice: exhibitor.meeting_notice || '',
    message: self ? '不能向自己预约私人会议' : open ? '' : CLOSED_MESSAGE,
    fields: open ? await loadFields(exhibitor.id) : [],
  });
});

app.post('/', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  assertNotLimited(user, 'register');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const bounds = await readLimits();
    const input = parseSchema(meetingApplySchema(), body);
    assertTime(input.meetingTime);
    if (input.exhibitorId === user.userId) throw badRequest('不能向自己预约私人会议');
    const document = answerDocument({
      fields: await loadFields(input.exhibitorId),
      source: { text: input.answers },
      limits: { textFill: Number(bounds.textFill) || 200, answer: Number(bounds.answer) || 200 },
    });
    if (document.message) throw badRequest(document.message);
    const { maxFutureMeetings } = await readSection('exhibitor');
    const id = newId('meet');
    try {
      await transaction(async (client) => {
        const locked = await client.query<ExhibitorGate>(
          'SELECT id, role, status, accept_meetings, nickname, exhibitor_expires_at FROM users WHERE id = $1 FOR UPDATE',
          [input.exhibitorId],
        );
        const exhibitor = locked.rows[0];
        if (!exhibitor) throw badRequest('用户不存在或已删除');
        if (!meetingsOpen(exhibitor)) throw badRequest(CLOSED_MESSAGE);
        const past = await client.query<{ past: boolean }>('SELECT $1::date < CURRENT_DATE AS past', [
          input.meetingDate,
        ]);
        if (past.rows[0]?.past) throw badRequest('会议日期不能早于今天');
        if (maxFutureMeetings > 0) {
          const counted = await client.query<{ total: number }>(
            `SELECT count(*)::int AS total FROM private_meetings
              WHERE exhibitor_id = $1 AND meeting_date >= CURRENT_DATE AND status IN ('pending', 'approved')`,
            [exhibitor.id],
          );
          if ((counted.rows[0]?.total ?? 0) >= maxFutureMeetings) {
            throw badRequest(`同时筹备的私人会议最多 ${maxFutureMeetings} 个`);
          }
        }
        const visitor = await client.query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [
          user.userId,
        ]);
        await client.query(
          `INSERT INTO private_meetings
             (id, exhibitor_id, visitor_id, visitor_name, meeting_date, meeting_time, answers, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [
            id,
            exhibitor.id,
            user.userId,
            visitor.rows[0]?.nickname || '用户',
            input.meetingDate,
            input.meetingTime,
            document.text,
          ],
        );
      });
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
        throw badRequest(DUPLICATE_MESSAGE);
      }
      throw error;
    }
    const created = await loadMeeting(id);
    return { meeting: meetingPayload(created!) };
  });
});

app.get('/:id', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const row = await loadMeeting(c.req.param('id'));
  const visible = row && (user.role === 'admin' || row.visitor_id === user.userId || row.exhibitor_id === user.userId);
  if (!visible) return jsonResponse(c, { found: false, error: '私人会议不存在或已删除' });
  return jsonResponse(c, { found: true, meeting: meetingPayload(row) });
});

app.post('/:id/cancel', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  return mutate(c, async () => {
    const row = await loadMeeting(c.req.param('id'));
    if (!row) throw badRequest('私人会议不存在或已删除');
    if (row.visitor_id !== user.userId) throw forbidden('只能撤销自己的会议申请');
    if (row.status === 'cancelled') throw badRequest('该会议已撤销，无需重复操作');
    if (row.status === 'rejected') throw badRequest('已拒绝的会议不能撤销');
    if (row.status === 'approved' && row.allow_cancel !== true) throw badRequest('展商未允许撤销已通过的会议');
    if (row.status !== 'pending' && row.status !== 'approved') throw badRequest('这场会议不能撤销');
    await query(`UPDATE private_meetings SET status = 'cancelled', updated_at = now() WHERE id = $1`, [row.id]);
    return { meeting: meetingPayload((await loadMeeting(row.id))!) };
  });
});

app.put('/:id/status', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const status = labels.toRegistrationStatus(body.status);
    if (status !== 'approved' && status !== 'rejected') throw badRequest('会议状态只能是 已通过 / 已拒绝');
    const row = await loadMeeting(c.req.param('id'));
    if (!row) throw badRequest('私人会议不存在或已删除');
    const isAdmin = user.role === 'admin';
    if (!isAdmin && (user.role !== 'exhibitor' || row.exhibitor_id !== user.userId)) {
      throw forbidden('只能审核自己的私人会议');
    }
    if (row.locked && !isAdmin) throw forbidden(LOCKED_MESSAGE);
    await query(`UPDATE private_meetings SET status = $2, updated_at = now() WHERE id = $1`, [row.id, status]);
    return { meeting: meetingPayload((await loadMeeting(row.id))!) };
  });
});

app.put('/:id/lock', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  if (user.role !== 'admin') throw forbidden('只有管理员可以限制私人会议');
  const body = bodyRecord(await readJsonBody(c));
  return mutate(c, async () => {
    const locked = parseSchema(z.object({ locked: boolSchema(false) }), body).locked;
    const row = await loadMeeting(c.req.param('id'));
    if (!row) throw badRequest('私人会议不存在或已删除');
    await query('UPDATE private_meetings SET locked = $2, updated_at = now() WHERE id = $1', [row.id, locked]);
    return { meeting: meetingPayload((await loadMeeting(row.id))!) };
  });
});

app.delete('/:id', authenticateHono, async (c) => {
  const user = requireUser({ user: userOf(c) });
  if (user.role !== 'admin') throw forbidden('只有管理员可以删除私人会议');
  return mutate(c, async () => {
    const row = await loadMeeting(c.req.param('id'));
    if (!row) throw badRequest('私人会议不存在或已删除');
    await query('DELETE FROM private_meetings WHERE id = $1', [row.id]);
    return {};
  });
});

export function createMeetingsRoutes() {
  return app;
}

export const MEETING_ENDPOINTS: readonly [string, string][] = [
  ['GET', '/settings'],
  ['PUT', '/settings'],
  ['GET', '/mine'],
  ['GET', '/inbox'],
  ['GET', '/apply/:exhibitorId'],
  ['POST', '/'],
  ['GET', '/:id'],
  ['POST', '/:id/cancel'],
  ['PUT', '/:id/status'],
  ['PUT', '/:id/lock'],
  ['DELETE', '/:id'],
];
