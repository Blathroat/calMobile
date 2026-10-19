/**
 * 写操作信封：业务规则失败回 HTTP 200 + `{ ok:false, error }`。
 *
 * 中文 error 是兜底，稳定错误码（errorCode / errorParams）只在有码时出现——
 * 前端遇到不认识的码就显示中文，因此没有码时形状必须与改造前逐字一致。
 */
import assert from 'node:assert/strict';
import { ApiError, badRequest } from '../domain/errors.js';
import { runEnveloped } from './envelope.js';

test('成功信封补上 ok / error', async () => {
  assert.deepEqual(await runEnveloped(() => ({ id: 'reg-1' })), { ok: true, error: '', id: 'reg-1' });
});

test('业务失败收成 200 信封；带码时把 errorCode / errorParams 一起下发', async () => {
  assert.deepEqual(
    await runEnveloped(() => {
      throw badRequest('报名记录不存在或已撤销', { code: 'registration.notFound' });
    }),
    { ok: false, error: '报名记录不存在或已撤销', errorCode: 'registration.notFound' },
  );
  assert.deepEqual(
    await runEnveloped(() => {
      throw badRequest('当前状态为「已通过」，只有已通过的报名可以核销', {
        code: 'checkin.notApproved',
        params: { status: '已通过' },
      });
    }),
    {
      ok: false,
      error: '当前状态为「已通过」，只有已通过的报名可以核销',
      errorCode: 'checkin.notApproved',
      errorParams: { status: '已通过' },
    },
  );
  // 没有码：形状与改造前一致（不多一个字段）。
  assert.deepEqual(
    await runEnveloped(() => {
      throw new ApiError(409, '操作与当前状态冲突');
    }),
    { ok: false, error: '操作与当前状态冲突' },
  );
});
