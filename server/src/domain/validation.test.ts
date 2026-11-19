import assert from 'node:assert/strict';
import { z } from 'zod';
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
  validationCode,
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
  resetPasswordSchema,
  reviewQuerySchema,
  reviewStatusSchema,
  userStatusSchema,
} from './schemas.js';

const limits = DEFAULT_SETTINGS.limits;

function messageOf(run: () => unknown): string {
  return errorOf(run).message;
}

function errorOf(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error;
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
    '选项最多 2 个字符',
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

test('注册 schema 保留动态上限，并允许中文等多语言用户名', () => {
  const schema = registerSchema(limits);
  const parsed = parseSchema(schema, { username: ' user_1 ', password: 'password', email: 'u@example.com' });
  assert.deepEqual(parsed, { username: 'user_1', password: 'password', email: 'u@example.com' });
  // 用户名允许「正常的 UTF-8 字符」：各文字的字母、数字、组合符，外加 _ . -。
  // 中文、日文、韩文、西里尔、阿拉伯、天城文（含组合符）与带重音的拉丁字母都通过。
  const accepted = [
    '中文用户',
    '山田太郎',
    '김민준',
    'Иван',
    'محمد',
    'हिन्दी',
    'François',
    '用户_1.2-3',
    'e\u0301le\u0301phant',
  ];
  for (const username of accepted) {
    assert.equal(
      parseSchema(schema, { username, password: 'password', email: 'u@example.com' }).username,
      username,
      `${username} 应当通过`,
    );
  }
  // 用户名两侧的空白仍然被 trim 掉，长度按 trim 后的值算。
  assert.equal(
    parseSchema(schema, { username: '  中文用户  ', password: 'password', email: 'u@example.com' }).username,
    '中文用户',
  );
  assert.equal(
    messageOf(() => parseSchema(schema, { username: '中文用户!', password: 'password', email: 'u@example.com' })),
    '用户名只能包含中文、字母、数字、下划线、点或横线',
  );
  assert.equal(
    messageOf(() => parseSchema(schema, { username: 'user', password: 'x', email: 'u@example.com' })),
    `密码长度需在 ${limits.passwordMin}-${limits.passwordMax} 个字符之间`,
  );
});

test('注册用户名的字符集边界：内部空白、控制字符、标点和 emoji 都拒绝', () => {
  const schema = registerSchema(limits);
  // 用户名先 trim 再去空白：只有**内部**空白 / 控制字符会留下来被拒。
  const rejected = ['user name', 'user\nname', 'user\u0000name', '用户😀', 'user@name', 'user!', '张三，', 'user+1'];
  for (const username of rejected) {
    const error = errorOf(() => parseSchema(schema, { username, password: 'password', email: 'u@example.com' }));
    assert.equal(error.errorCode, 'validation.usernameCharset', `${JSON.stringify(username)} 应当因字符集被拒`);
    assert.equal(error.message, '用户名只能包含中文、字母、数字、下划线、点或横线');
  }
  // 纯 emoji 也是符号而不是字母 / 数字 / 组合符。
  assert.equal(
    errorOf(() => parseSchema(schema, { username: '🎉🎉🎉', password: 'password', email: 'u@example.com' })).errorCode,
    'validation.usernameCharset',
  );
});

test('注册用户名的长度边界按管理员的 usernameMin / usernameMax 判定', () => {
  const schema = registerSchema(limits);
  const min = limits.usernameMin;
  const max = limits.usernameMax;
  // 中文每个字算一个字符（JS 的 .length 与界面计数器同口径）。
  assert.equal(
    parseSchema(schema, { username: '中'.repeat(min), password: 'password', email: 'u@example.com' }).username,
    '中'.repeat(min),
  );
  assert.equal(
    parseSchema(schema, { username: '中'.repeat(max), password: 'password', email: 'u@example.com' }).username,
    '中'.repeat(max),
  );
  assert.equal(
    messageOf(() =>
      parseSchema(schema, { username: '中'.repeat(min - 1), password: 'password', email: 'u@example.com' }),
    ),
    `用户名长度需在 ${min}-${max} 个字符之间`,
  );
  assert.equal(
    messageOf(() =>
      parseSchema(schema, { username: 'a'.repeat(max + 1), password: 'password', email: 'u@example.com' }),
    ),
    `用户名长度需在 ${min}-${max} 个字符之间`,
  );
  // 长度用 trim 后的值判断：两侧空白不会把短用户名「凑」到下限。
  assert.equal(
    messageOf(() => parseSchema(schema, { username: '  中  ', password: 'password', email: 'u@example.com' })),
    `用户名长度需在 ${min}-${max} 个字符之间`,
  );
});

test('登录不限制用户名字符集：用户名或邮箱都能带非 ASCII 字符', () => {
  assert.equal(parseSchema(loginSchema, { username: '中文用户', password: 'password' }).username, '中文用户');
  assert.equal(
    parseSchema(loginSchema, { username: '用户@example.com', password: 'password' }).username,
    '用户@example.com',
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
  // 闭展日期选填（空 = 单日），但填了就不能早于开展日期。
  assert.equal(
    messageOf(() =>
      parseSchema(schema, {
        title: '日期测试',
        venue: '展馆',
        category: '分类',
        date: '2026-03-10',
        time: '09:00',
        endDate: '2026-03-01',
      }),
    ),
    '闭展日期不能早于开展日期',
  );
  assert.equal(
    parseSchema(schema, {
      title: '日期测试',
      venue: '展馆',
      category: '分类',
      date: '2026-03-10',
      time: '09:00',
      endDate: '2026-03-12',
    }).endDate,
    '2026-03-12',
  );
});

test('收集项的选项按单选和多选各自的上限拦住', () => {
  assert.equal(
    messageOf(() =>
      parseSchema(fieldsSchema({ ...limits, radioOption: 2 }), [{ title: '来源', type: 'radio', options: ['朋友们'] }]),
    ),
    '单选选项最多 2 个字符',
  );
  assert.equal(
    messageOf(() =>
      parseSchema(fieldsSchema({ ...limits, checkOption: 2 }), [
        { title: '需求', type: 'checkbox', options: ['停车位'] },
      ]),
    ),
    '多选选项最多 2 个字符',
  );
  assert.deepEqual(
    parseSchema(fieldsSchema({ ...limits, radioOption: 2, checkOption: 2 }), [
      { title: '来源', type: 'radio', options: ['友'] },
      { title: '需求', type: 'checkbox', options: ['车'] },
    ]).map((item) => item.options),
    [['友'], ['车']],
  );
});

test('收集项 schema 限制数组长度、项类型和动态标题上限', () => {
  assert.deepEqual(
    parseSchema(fieldsSchema(limits), [{ title: '说明', type: 'text', options: ['x'.repeat(61)] }])[0]?.options,
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
    '收集项类型只能是 text / radio / checkbox',
  );
  assert.equal(
    messageOf(() => parseSchema(fieldsSchema({ ...limits, fieldTitle: 2 }), [{ title: '过长标题' }])),
    '文本框标题最多 2 个字符',
  );
});

test('资料 schema 使用服务器上限', () => {
  assert.equal(
    messageOf(() => parseSchema(profilePatchSchema({ ...limits, bio: 2 }), { bio: '内容超长' })),
    '个人简介最多 2 个字符',
  );
});

test('更新展会时显式清空日期仍会报错，时间可以清空（时间选填）', () => {
  const existing = { title: '展会', exhibition_date: '2026-03-01', time: '09:00' };
  assert.equal(
    messageOf(() => parseSchema(exhibitionInputSchema(limits, existing), { title: '展会', date: '' })),
    '请选择展会日期',
  );
  // 时间选填：显式清空表示只显示日期，保存后库里存空串。
  assert.equal(parseSchema(exhibitionInputSchema(limits, existing), { title: '展会', time: '' }).time, '');
});

test('更新展会没带 endDate 时保留库里的闭展日期', () => {
  const existing = {
    title: '展会',
    exhibition_date: '2026-03-01',
    exhibition_end_date: '2026-03-05',
    time: '09:00',
  };
  assert.equal(parseSchema(exhibitionInputSchema(limits, existing), { title: '展会' }).endDate, '2026-03-05');
  // 显式传空串 = 改回单日展会。
  assert.equal(parseSchema(exhibitionInputSchema(limits, existing), { title: '展会', endDate: '' }).endDate, '');
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
  // 协议值是 code；旧中文仍要能写进来（老客户端 / 老表单），两套都验一遍。
  assert.equal(parseSchema(exhibitionStatusSchema, { status: 'review' }).status, 'review');
  assert.equal(parseSchema(exhibitionStatusSchema, { status: '需审核' }).status, 'review');
  assert.equal(
    messageOf(() => parseSchema(exhibitionStatusSchema, { status: '未知' })),
    '报名方式只能是 review / optional / display / closed / ended',
  );
  assert.equal(parseSchema(reviewStatusSchema, { status: 'approved' }).status, 'approved');
  assert.equal(parseSchema(reviewStatusSchema, { status: '已通过' }).status, 'approved');
  assert.equal(
    messageOf(() => parseSchema(reviewStatusSchema, { status: '未知' })),
    '报名状态只能是 pending / approved / rejected / cancelled / attended',
  );
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: ' 已通过 ' }), {
    statusLabel: '已通过',
    statusCode: 'approved',
  });
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: '全部' }), { statusLabel: '全部', statusCode: '' });
  // 'all' 是新前端的筛选哨兵，同样表示「不筛选」。
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: 'all' }), { statusLabel: 'all', statusCode: '' });
  assert.deepEqual(parseSchema(reviewQuerySchema, { status: 'pending' }), {
    statusLabel: 'pending',
    statusCode: 'pending',
  });
  assert.equal(parseSchema(userStatusSchema, { status: '封禁' }).status, 'banned');
  assert.equal(
    messageOf(() => parseSchema(userStatusSchema, { status: '未知' })),
    '账号状态只能是 active / limited / banned',
  );
  assert.equal(
    messageOf(() => parseSchema(monthQuerySchema, { year: 2026, month: 13 })),
    '月份不能大于 12',
  );
});

test('校验失败带稳定错误码与占位值，中文一个字不变', () => {
  const required = errorOf(() => parseSchema(textSchema({ label: '展会名称', max: 3 }), ''));
  assert.equal(required.message, '请输入展会名称');
  assert.equal(required.errorCode, 'validation.required');
  assert.deepEqual(required.errorParams, { label: '展会名称' });

  const tooLong = errorOf(() => parseSchema(textSchema({ label: '展会名称', max: 3 }), '1234'));
  assert.equal(tooLong.message, '展会名称最多 3 个字符');
  assert.equal(tooLong.errorCode, 'validation.tooLong');
  assert.deepEqual(tooLong.errorParams, { label: '展会名称', max: 3 });

  const integer = errorOf(() => parseSchema(intSchema({ label: '年份', min: 1970, max: 9999 }), 'abc'));
  assert.equal(integer.message, '年份必须是整数');
  assert.equal(integer.errorCode, 'validation.integer');
  assert.deepEqual(integer.errorParams, { label: '年份' });

  const tooSmall = errorOf(() => parseSchema(monthQuerySchema, { year: 1900, month: 6, day: 1 }));
  assert.equal(tooSmall.message, '年份不能小于 1970');
  assert.equal(tooSmall.errorCode, 'validation.min');
  assert.deepEqual(tooSmall.errorParams, { label: '年份', min: 1970 });

  const badDate = errorOf(() => parseSchema(isoDateSchema({ label: '展会日期', required: true }), '2026/01/01'));
  assert.equal(badDate.message, '展会日期格式应为 YYYY-MM-DD');
  assert.equal(badDate.errorCode, 'validation.dateFormat');
  assert.deepEqual(badDate.errorParams, { label: '展会日期' });
});

test('validationCode：取第一条带码的 issue，没有码时返回 null', () => {
  const coded = z
    .object({ a: textSchema({ label: '甲' }), b: intSchema({ label: '乙' }) })
    .safeParse({ a: '', b: 'x' });
  assert.ok(!coded.success);
  assert.deepEqual(validationCode(coded.error), { code: 'validation.required', params: { label: '甲' } });

  // 没有 i18nCode 的 issue（第三方 / 未改造的 schema）：不发码，响应只带中文。
  const uncoded = z.object({ n: z.number() }).safeParse({ n: 'x' });
  assert.ok(!uncoded.success);
  assert.equal(validationCode(uncoded.error), null);

  const parsed = z.object({ n: z.number() }).safeParse({ n: 'x' });
  assert.ok(!parsed.success);
  const error = errorOf(() => parseSchema(z.object({ n: z.number() }), { n: 'x' }));
  assert.equal(error.errorCode, undefined);
  assert.equal(error.errorParams, undefined);
  assert.ok(error.message, '没有码时仍然给中文文案');
});
