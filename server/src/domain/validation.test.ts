import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../config/migrate.js';
import { ApiError } from './errors.js';
import {
  boolSchema,
  emailSchema,
  intSchema,
  isoDateSchema,
  parseSchema,
  stringListSchema,
  textSchema,
  timeRangeSchema,
} from './validation.js';
import {
  exhibitionStatusSchema,
  exhibitionInputSchema,
  fieldsSchema,
  loginSchema,
  loginVerifySchema,
  monthQuerySchema,
  passwordChangeSchema,
  profilePatchSchema,
  registerSchema,
  registrationSchema,
  resetPasswordSchema,
  reviewQuerySchema,
  reviewStatusSchema,
  userStatusSchema,
} from './schemas.js';

const limits = DEFAULT_SETTINGS.limits;

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error.message;
  }
  assert.fail('应当校验失败');
}

test('文本 schema 去空白、校验必填和动态上限', () => {
  assert.equal(parseSchema(textSchema({ label: '姓名' }), '  张三  '), '张三');
  assert.equal(
    messageOf(() => parseSchema(textSchema({ label: '姓名' }), '')),
    '请输入姓名',
  );
  assert.equal(
    messageOf(() => parseSchema(textSchema({ label: '姓名', max: 2 }), '张三丰')),
    '姓名最多 2 个字符',
  );
});

test('整数、布尔和字符串列表 schema 保持表单输入兼容', () => {
  assert.equal(parseSchema(intSchema({ label: '月份', min: 1, max: 12 }), '09'), 9);
  assert.equal(parseSchema(intSchema({ label: '日期', fallback: 0 }), undefined), 0);
  assert.equal(
    messageOf(() => parseSchema(intSchema({ label: '月份' }), 'abc')),
    '月份必须是整数',
  );
  assert.equal(
    messageOf(() => parseSchema(intSchema({ label: '月份', min: 1, max: 12 }), 13)),
    '月份不能大于 12',
  );
  assert.deepEqual(parseSchema(stringListSchema({ max: 2 }), [' a ', '', 'b', 'c']), ['a', 'b']);
  assert.deepEqual(parseSchema(stringListSchema({ max: 2, itemMax: 2 }), ['a', 'b', 'too long']), ['a', 'b']);
  assert.equal(
    messageOf(() => parseSchema(stringListSchema({ label: '选项', itemMax: 2 }), ['abc'])),
    '选项单项最多 2 个字符',
  );
  assert.equal(parseSchema(boolSchema(), 'true'), true);
  assert.equal(parseSchema(boolSchema(), 'false'), false);
});

test('邮箱和时间 schema 使用统一中文错误', () => {
  assert.equal(parseSchema(emailSchema, ' test@example.com '), 'test@example.com');
  assert.equal(
    messageOf(() => parseSchema(emailSchema, 'not-an-email')),
    '邮箱格式不正确',
  );
  assert.equal(parseSchema(timeRangeSchema(), '09:00-17:30'), '09:00-17:30');
  assert.equal(
    messageOf(() => parseSchema(timeRangeSchema({ label: '展会时间' }), '9:00')),
    '展会时间格式应为 09:00-17:30',
  );
});

test('ISO 日期 schema 回查 Date 归一化，拒绝不存在的日期', () => {
  assert.equal(parseSchema(isoDateSchema({ required: true }), '2026-02-28'), '2026-02-28');
  assert.equal(
    messageOf(() => parseSchema(isoDateSchema({ required: true }), '2026-02-31')),
    '日期不是一个有效日期',
  );
  assert.equal(
    messageOf(() => parseSchema(isoDateSchema({ required: true }), '2026/02/28')),
    '日期格式应为 YYYY-MM-DD',
  );
});

test('注册 schema 保留动态上限和用户名字符集规则', () => {
  const schema = registerSchema(limits);
  const parsed = parseSchema(schema, { username: ' user_1 ', password: 'password', email: 'u@example.com' });
  assert.deepEqual(parsed, { username: 'user_1', password: 'password', email: 'u@example.com' });
  assert.equal(
    messageOf(() => parseSchema(schema, { username: '中文用户', password: 'password', email: 'u@example.com' })),
    '用户名只能包含字母、数字、下划线、点或横线',
  );
  assert.equal(
    messageOf(() => parseSchema(schema, { username: 'user', password: 'x', email: 'u@example.com' })),
    `密码长度需在 ${limits.passwordMin}-${limits.passwordMax} 个字符之间`,
  );
});

test('展会 schema 拒绝非法日期并保留报名日期顺序规则', () => {
  const schema = exhibitionInputSchema(limits);
  assert.equal(
    messageOf(() =>
      parseSchema(schema, {
        title: '日期测试',
        venue: '展馆',
        category: '分类',
        date: '2026-02-31',
        time: '09:00',
      }),
    ),
    '展会日期不是一个有效日期',
  );
  assert.equal(
    messageOf(() =>
      parseSchema(schema, {
        title: '日期测试',
        venue: '展馆',
        category: '分类',
        date: '2026-03-01',
        time: '09:00',
        registrationStart: '2026-03-10',
        registrationEnd: '2026-03-01',
      }),
    ),
    '报名截止日期不能早于开始日期',
  );
});

test('收集项 schema 限制数组长度、项类型和动态标题上限', () => {
  assert.deepEqual(
    parseSchema(fieldsSchema(limits), [{ title: '说明', type: '文本', options: ['x'.repeat(61)] }])[0]?.options,
    [],
  );
  assert.equal(
    messageOf(() => parseSchema(fieldsSchema(limits), {})),
    '收集项需为数组',
  );
  assert.equal(
    messageOf(() => parseSchema(fieldsSchema(limits), Array(51).fill({ title: '有效标题' }))),
    '收集项最多 50 项',
  );
  assert.equal(
    messageOf(() => parseSchema(fieldsSchema(limits), [{ title: '有效标题', type: '未知' }])),
    '收集项类型只能是 文本 / 单选 / 多选',
  );
  assert.equal(
    messageOf(() => parseSchema(fieldsSchema({ ...limits, fieldTitle: 2 }), [{ title: '过长标题' }])),
    '收集项标题最多 2 个字符',
  );
});

test('资料与报名 schema 使用服务器上限', () => {
  assert.equal(
    messageOf(() => parseSchema(profilePatchSchema({ ...limits, bio: 2 }), { bio: '内容超长' })),
    '个人简介最多 2 个字符',
  );
  assert.equal(
    messageOf(() =>
      parseSchema(registrationSchema(2), {
        exhibitionId: 'exh-1',
        visitorName: '张三',
        visitorType: '普通观众',
        answers: 'abc',
      }),
    ),
    '报名填写内容最多 2 个字符',
  );
});

test('更新展会时显式清空日期和时间仍会报错', () => {
  const existing = { title: '展会', exhibition_date: '2026-03-01', time: '09:00' };
  assert.equal(
    messageOf(() => parseSchema(exhibitionInputSchema(limits, existing), { title: '展会', date: '' })),
    '请选择展会日期',
  );
  assert.equal(
    messageOf(() => parseSchema(exhibitionInputSchema(limits, existing), { title: '展会', time: '' })),
    '请输入展会时间',
  );
});

test('登录、重置密码和修改密码的中文错误保持一致', () => {
  assert.equal(
    messageOf(() => parseSchema(loginSchema, {})),
    '请输入账号与密码',
  );
  assert.equal(
    messageOf(() => parseSchema(loginVerifySchema, { ticket: 't' })),
    '请填写验证码',
  );
  assert.equal(
    messageOf(() =>
      parseSchema(resetPasswordSchema(limits), {
        email: 'u@example.com',
        code: '123456',
        newPassword: 'password',
        confirmPassword: 'different',
      }),
    ),
    '两次输入的新密码不一致',
  );
  assert.equal(
    messageOf(() =>
      parseSchema(passwordChangeSchema({ ...limits, passwordMin: 12 }), {
        currentPassword: 'old',
        newPassword: 'short',
        confirmPassword: 'short',
      }),
    ),
    '密码至少需要 12 个字符',
  );
});

test('状态白名单和月份范围由 schema 校验', () => {
  assert.equal(parseSchema(exhibitionStatusSchema, { status: '需审核' }).status, 'review');
  assert.equal(
    messageOf(() => parseSchema(exhibitionStatusSchema, { status: '未知' })),
    '报名方式只能是 需审核 / 无需审核 / 仅展示 / 截止报名 / 已结束',
  );
  assert.equal(parseSchema(reviewStatusSchema, { status: '已通过' }).status, 'approved');
  assert.equal(
    messageOf(() => parseSchema(reviewStatusSchema, { status: '未知' })),
    '报名状态只能是 待审核 / 已通过 / 已拒绝 / 已撤销 / 已参加',
  );
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: ' 已通过 ' }), {
    statusLabel: '已通过',
    statusCode: 'approved',
  });
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: '全部' }), { statusLabel: '全部', statusCode: '' });
  assert.equal(parseSchema(userStatusSchema, { status: '封禁' }).status, 'banned');
  assert.equal(
    messageOf(() => parseSchema(userStatusSchema, { status: '未知' })),
    '账号状态只能是 正常 / 受限 / 封禁',
  );
  assert.equal(
    messageOf(() => parseSchema(monthQuerySchema, { year: 2026, month: 13 })),
    '月份不能大于 12',
  );
});
