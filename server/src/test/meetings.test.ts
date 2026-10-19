/**
 * 私人会议 契约测试。
 *
 * 私人会议的申请、审核、额度、限制、取消与日历圆点。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { del, get, login, post, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('私人会议：申请、审核、额度、限制与日历圆点', async () => {
  const exhibitorId = 'usr-2';
  const before = await get('/api/v1/settings', { token: tokens.admin.token });
  const maxExhibitions = Number(before.body.exhibitor?.maxFutureExhibitions ?? 0);
  const maxMeetings = Number(before.body.exhibitor?.maxFutureMeetings ?? 0);
  const date = '2099-06-15';
  const otherDate = '2099-06-16';
  try {
    const adminOwnInbox = await get('/api/v1/meetings/inbox', { token: tokens.admin.token });
    assert.strictEqual(adminOwnInbox.status, 200);
    assert.ok(Array.isArray(adminOwnInbox.body.records));
    assert.strictEqual(adminOwnInbox.body.records.length, 0);
    const notExhibitor = await get('/api/v1/meetings/inbox?exhibitorId=usr-3', { token: tokens.admin.token });
    assert.strictEqual(notExhibitor.status, 400);
    assert.match(String(notExhibitor.body.error), /不是展商/);

    const closed = await get(`/api/v1/meetings/apply/${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(closed.body.found, true);
    assert.strictEqual(closed.body.open, false);
    assert.strictEqual(closed.body.message, '展商暂不接受会议预约');
    const closedPost = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: date, answers: '' },
      { token: tokens.user.token },
    );
    assert.strictEqual(closedPost.status, 200);
    assert.strictEqual(closedPost.body.ok, false);
    assert.strictEqual(closedPost.body.error, '展商暂不接受会议预约');

    const saved = await put(
      '/api/v1/meetings/settings',
      {
        acceptMeetings: true,
        fields: [{ title: '来意', type: 'text', required: true, options: [] }],
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.acceptMeetings, true);
    assert.strictEqual(saved.body.allowCancel, false);
    assert.strictEqual(saved.body.notice, '');

    const open = await get(`/api/v1/meetings/apply/${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(open.body.open, true);
    assert.strictEqual(open.body.notice, '');
    assert.strictEqual(open.body.fields[0].title, '来意');
    assert.strictEqual(open.body.roleCode, 'exhibitor');
    const profile = await get(`/api/v1/users/public?userId=${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(profile.body.meetingsOpen, true);
    assert.strictEqual(profile.body.roleCode, 'exhibitor');

    const adminHost = 'usr-1';
    const adminSaved = await put(
      '/api/v1/meetings/settings',
      { acceptMeetings: true, fields: [{ title: '议题', type: 'text', required: true, options: [] }] },
      { token: tokens.admin.token },
    );
    assert.strictEqual(adminSaved.body.ok, true, JSON.stringify(adminSaved.body));
    const adminOpen = await get(`/api/v1/meetings/apply/${adminHost}`, { token: tokens.user.token });
    assert.strictEqual(adminOpen.body.open, true);
    assert.strictEqual(adminOpen.body.roleCode, 'admin');
    const adminProfile = await get(`/api/v1/users/public?userId=${adminHost}`, { token: tokens.user.token });
    assert.strictEqual(adminProfile.body.meetingsOpen, true);
    const bookedAdmin = await post(
      '/api/v1/meetings',
      { exhibitorId: adminHost, meetingDate: otherDate, answers: '议题：管理权限' },
      { token: tokens.user.token },
    );
    assert.strictEqual(bookedAdmin.body.ok, true, JSON.stringify(bookedAdmin.body));
    const adminInbox = await get('/api/v1/meetings/inbox', { token: tokens.admin.token });
    assert.strictEqual(adminInbox.status, 200);
    assert.ok(adminInbox.body.records.some((item: { id?: string }) => item.id === bookedAdmin.body.meeting.id));

    const missing = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: date, meetingTime: '09:30', answers: '' },
      { token: tokens.user.token },
    );
    assert.strictEqual(missing.body.ok, false);
    assert.match(String(missing.body.error), /来意/);

    const created = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: date, meetingTime: '09:30', answers: '来意：洽谈' },
      { token: tokens.user.token },
    );
    assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
    const meetingId = created.body.meeting.id;
    assert.strictEqual(created.body.meeting.status, '待审核');
    assert.strictEqual(created.body.meeting.exhibitorRole, 'exhibitor');
    assert.strictEqual(created.body.meeting.visitorRole, 'user');

    const duplicate = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: date, answers: '来意：再约一次' },
      { token: tokens.user.token },
    );
    assert.strictEqual(duplicate.body.ok, false);
    assert.match(String(duplicate.body.error), /这一天已经/);

    const past = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: '2000-01-01', answers: '来意：补记' },
      { token: tokens.user.token },
    );
    assert.strictEqual(past.body.ok, false);
    assert.match(String(past.body.error), /不能早于今天/);

    const self = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: otherDate, answers: '来意：自己' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(self.body.ok, false);
    assert.match(String(self.body.error), /不能向自己/);
    assert.strictEqual(self.body.errorCode, 'meeting.selfApply', '抛出形态的失败也要带稳定错误码');

    const pendingMonth = await get('/api/v1/exhibitions/month?year=2099&month=6', { token: tokens.user.token });
    assert.deepStrictEqual(pendingMonth.body.eventDays, []);
    assert.deepStrictEqual(pendingMonth.body.markedDays, [15, 16]);
    assert.strictEqual(pendingMonth.body.meetings.length, 2);
    assert.ok(pendingMonth.body.meetings.every((item: { status?: string }) => item.status === '待审核'));

    const approved = await put(
      `/api/v1/meetings/${meetingId}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(approved.body.ok, true, JSON.stringify(approved.body));
    assert.strictEqual(approved.body.meeting.status, '已通过');
    const mine = await get('/api/v1/meetings/mine', { token: tokens.user.token });
    assert.ok(
      mine.body.some((item: { id: string; status: string }) => item.id === meetingId && item.status === '已通过'),
    );

    const userMonth = await get('/api/v1/exhibitions/month?year=2099&month=6', { token: tokens.user.token });
    assert.deepStrictEqual(userMonth.body.markedDays, [15, 16]);
    assert.ok(
      userMonth.body.meetings.some(
        (item: { id?: string; status?: string; role?: string; titleRole?: string }) =>
          item.id === meetingId &&
          item.status === '已通过' &&
          item.role === 'visitor' &&
          item.titleRole === 'exhibitor',
      ),
    );
    const hostMonth = await get('/api/v1/exhibitions/month?year=2099&month=6', { token: tokens.exhibitor.token });
    assert.deepStrictEqual(hostMonth.body.markedDays, [15]);
    assert.ok(
      hostMonth.body.meetings.some(
        (item: { id?: string; role?: string; titleRole?: string }) =>
          item.id === meetingId && item.role === 'host' && item.titleRole === 'user',
      ),
    );
    assert.deepStrictEqual(hostMonth.body.eventDays, []);

    const quota = await put('/api/v1/settings', { maxFutureMeetings: 1 }, { token: tokens.admin.token });
    assert.strictEqual(Number(quota.body.settings.exhibitor.maxFutureMeetings), 1);
    const clamped = await put('/api/v1/settings', { maxFutureMeetings: 999 }, { token: tokens.admin.token });
    assert.strictEqual(Number(clamped.body.settings.exhibitor.maxFutureMeetings), 100);
    await put('/api/v1/settings', { maxFutureMeetings: 1 }, { token: tokens.admin.token });
    const blocked = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: otherDate, answers: '来意：第二场' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(blocked.body.ok, false);
    assert.match(String(blocked.body.error), /最多 1 个/);
    assert.strictEqual(blocked.body.errorCode, 'meeting.quotaExceeded');
    assert.deepEqual(blocked.body.errorParams, { max: 1 }, '带变量的码要给出占位值');

    const locked = await put(`/api/v1/meetings/${meetingId}/lock`, { locked: true }, { token: tokens.admin.token });
    assert.strictEqual(locked.body.ok, true);
    assert.strictEqual(locked.body.meeting.locked, true);
    const exhibitorBlocked = await put(
      `/api/v1/meetings/${meetingId}/status`,
      { status: 'rejected' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(exhibitorBlocked.status, 403);
    const adminStatus = await put(
      `/api/v1/meetings/${meetingId}/status`,
      { status: 'rejected' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(adminStatus.body.meeting.status, '已拒绝');
    const rejectedMonth = await get('/api/v1/exhibitions/month?year=2099&month=6', { token: tokens.user.token });
    assert.ok(!rejectedMonth.body.markedDays.includes(15), '已拒绝的会议不打点');
    assert.ok(
      !rejectedMonth.body.meetings.some((item: { id?: string }) => item.id === meetingId),
      '已拒绝的会议不进当天列表',
    );
    assert.deepStrictEqual(rejectedMonth.body.markedDays, [16]);
    const unlocked = await put(`/api/v1/meetings/${meetingId}/lock`, { locked: false }, { token: tokens.admin.token });
    assert.strictEqual(unlocked.body.meeting.locked, false);
    const exhibitorAgain = await put(
      `/api/v1/meetings/${meetingId}/status`,
      { status: 'approved' },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(exhibitorAgain.body.ok, true);
    await put('/api/v1/settings', { maxFutureMeetings: 0 }, { token: tokens.admin.token });

    const pendingVisit = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: '2099-06-17', answers: '来意：先撤销' },
      { token: tokens.user.token },
    );
    assert.strictEqual(pendingVisit.body.ok, true, JSON.stringify(pendingVisit.body));
    const pendingCancel = await post(
      `/api/v1/meetings/${pendingVisit.body.meeting.id}/cancel`,
      {},
      { token: tokens.user.token },
    );
    assert.strictEqual(pendingCancel.body.ok, true, JSON.stringify(pendingCancel.body));
    assert.strictEqual(pendingCancel.body.meeting.status, '已撤销');

    const detail = await get(`/api/v1/meetings/${meetingId}`, { token: tokens.user.token });
    assert.strictEqual(detail.body.found, true);
    assert.strictEqual(detail.body.meeting.allowCancel, false);
    const unknownMeeting = await get('/api/v1/meetings/missing-meet', { token: tokens.user.token });
    assert.strictEqual(unknownMeeting.body.found, false);
    const blockedCancel = await post(`/api/v1/meetings/${meetingId}/cancel`, {}, { token: tokens.user.token });
    assert.strictEqual(blockedCancel.body.ok, false);
    const hostCancel = await post(`/api/v1/meetings/${meetingId}/cancel`, {}, { token: tokens.exhibitor.token });
    assert.strictEqual(hostCancel.status, 403);

    const withNotice = await put(
      '/api/v1/meetings/settings',
      {
        acceptMeetings: true,
        allowCancel: true,
        notice: '请提前一天确认时间',
        fields: [{ title: '来意', type: 'text', required: true, options: [] }],
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(withNotice.body.allowCancel, true);
    assert.strictEqual(withNotice.body.notice, '请提前一天确认时间');
    const noticed = await get(`/api/v1/meetings/apply/${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(noticed.body.notice, '请提前一天确认时间');
    const cancelled = await post(`/api/v1/meetings/${meetingId}/cancel`, {}, { token: tokens.user.token });
    assert.strictEqual(cancelled.body.ok, true, JSON.stringify(cancelled.body));
    assert.strictEqual(cancelled.body.meeting.status, '已撤销');
    const repeatCancel = await post(`/api/v1/meetings/${meetingId}/cancel`, {}, { token: tokens.user.token });
    assert.strictEqual(repeatCancel.body.ok, false);

    const removed = await del(`/api/v1/meetings/${meetingId}`, { token: tokens.admin.token });
    assert.strictEqual(removed.body.ok, true);
    const afterDelete = await get('/api/v1/exhibitions/month?year=2099&month=6', { token: tokens.user.token });
    assert.deepStrictEqual(afterDelete.body.markedDays, [16]);
    assert.ok(
      afterDelete.body.meetings.every(
        (item: { status?: string }) => item.status === '待审核' || item.status === '已通过',
      ),
    );

    await put('/api/v1/settings', { maxFutureMeetings: 0 }, { token: tokens.admin.token });
    const limited = await put('/api/v1/users/usr-2/status', { status: '受限' }, { token: tokens.admin.token });
    assert.strictEqual(limited.body.ok, true);
    const forced = await get('/api/v1/meetings/settings', { token: tokens.exhibitor.token });
    assert.strictEqual(forced.body.forcedOff, true);
    assert.strictEqual(forced.body.acceptMeetings, false);
    const settingsBlocked = await put(
      '/api/v1/meetings/settings',
      { acceptMeetings: true, fields: [] },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(settingsBlocked.status, 403);
    const whileLimited = await post(
      '/api/v1/meetings',
      { exhibitorId, meetingDate: otherDate, answers: '来意：受限期间' },
      { token: tokens.user.token },
    );
    assert.strictEqual(whileLimited.body.error, '展商暂不接受会议预约');

    await put('/api/v1/users/usr-2/status', { status: '正常' }, { token: tokens.admin.token });
    const stayedOff = await get('/api/v1/meetings/settings', { token: tokens.exhibitor.token });
    assert.strictEqual(stayedOff.body.forcedOff, false);
    assert.strictEqual(stayedOff.body.acceptMeetings, false);
    const stillClosed = await get(`/api/v1/meetings/apply/${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(stillClosed.body.open, false);

    const banned = await put('/api/v1/users/usr-2/status', { status: '封禁' }, { token: tokens.admin.token });
    assert.strictEqual(banned.body.ok, true);
    const whileBanned = await get(`/api/v1/meetings/apply/${exhibitorId}`, { token: tokens.user.token });
    assert.strictEqual(whileBanned.body.open, false);
    assert.strictEqual(whileBanned.body.message, '展商暂不接受会议预约');
    const hidden = await get(`/api/v1/users/public?userId=${exhibitorId}`);
    assert.strictEqual(hidden.body.meetingsOpen, false);
  } finally {
    await put('/api/v1/users/usr-2/status', { status: '正常' }, { token: tokens.admin.token });
    await pool.query(
      'UPDATE users SET accept_meetings = false, meeting_allow_cancel = false, meeting_notice = $2, status = $3 WHERE id = $1',
      [exhibitorId, '', 'active'],
    );
    await pool.query(
      'UPDATE users SET accept_meetings = false, meeting_allow_cancel = false, meeting_notice = $2 WHERE id = $1',
      ['usr-1', ''],
    );
    await pool.query('DELETE FROM private_meetings WHERE exhibitor_id = ANY($1::text[])', [[exhibitorId, 'usr-1']]);
    await pool.query('DELETE FROM meeting_fields WHERE exhibitor_id = ANY($1::text[])', [[exhibitorId, 'usr-1']]);
    await put(
      '/api/v1/settings',
      { maxFutureExhibitions: maxExhibitions, maxFutureMeetings: maxMeetings },
      { token: tokens.admin.token },
    );
    tokens.exhibitor = await login('exhibitor');
  }
});
