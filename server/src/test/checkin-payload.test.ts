/**
 * 核销响应的载荷契约：answers 保留原始多行文本，checkInTime 精确到秒。
 *
 * 页面要按收集项逐行渲染 answers，并显示到秒的核销时间；把 answers 压成一行、
 * 或只给到分钟都会让页面显示不出来。这里自造展会与报名，不依赖其它用例留下的
 * 记录（跑完删展会，外键级联清掉报名）。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { del, isoDateAfter, post, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 与 `to_char(check_in_time, 'YYYY-MM-DD HH24:MI:SS')` 一致：精确到秒，不带时区。 */
const CHECKED_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ANSWERS = '姓名 / 公司名称：载荷用例\n参观身份：专业观众';

test('核销响应带原始多行 answers 与秒级 checkInTime，重复核销沿用原时间', async () => {
  const created = await post(
    '/api/v1/exhibitions',
    {
      title: '核销载荷用例展',
      venue: '测试展馆',
      time: '09:00-17:00',
      date: isoDateAfter(21),
      category: '智能家居',
      status: '无需审核',
      qrEnabled: true,
    },
    { token: tokens.exhibitor.token },
  );
  assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
  const exhibitionId = created.body.exhibition.id;

  try {
    const submitted = await post(
      '/api/v1/registrations',
      { exhibitionId, visitorName: '载荷用例', visitorType: '专业观众', answers: ANSWERS },
      { token: tokens.user.token },
    );
    assert.strictEqual(submitted.body.ok, true, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.registration.status, '已通过', '无需审核的展会报名后应已通过');
    // 报名码带可轮换凭据，取报名接口下发的那一个，不按 id 手拼。
    const code = String(submitted.body.registration.checkInCode);
    assert.ok(code.startsWith(`CALMOBILE-CHECKIN|${exhibitionId}|`), `应当下发报名码：${code}`);

    const first = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
    assert.strictEqual(first.body.ok, true, JSON.stringify(first.body));
    // 页面按行解析收集项：压成一行或截断都会让所有收集项糊在一起。
    assert.strictEqual(first.body.record.answers, ANSWERS);
    assert.ok(first.body.record.answers.includes('\n'), 'answers 必须保留换行');
    assert.match(first.body.record.checkInTime, CHECKED_AT, `核销时间格式不对：${first.body.record.checkInTime}`);

    const again = await post('/api/v1/checkin', { code }, { token: tokens.exhibitor.token });
    assert.strictEqual(again.body.ok, false);
    assert.strictEqual(again.body.duplicated, true);
    assert.ok(again.body.error.includes('已经核销'), again.body.error);
    // 重复核销给的是原来那一次的时间，不是这次请求的时间。
    assert.strictEqual(again.body.record.checkInTime, first.body.record.checkInTime);
    assert.strictEqual(again.body.record.answers, ANSWERS);
  } finally {
    await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token });
  }
});
