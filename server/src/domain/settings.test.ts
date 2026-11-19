import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, THEME_COLORS } from '../config/migrate.js';
import { applyServerPatch, normalizeTheme, saveUiTheme } from './settings.js';

/**
 * `applyServerPatch()` 是纯函数（只做「校验 + 合并」），因此不连数据库就能测。
 *
 * 关注两件事：
 * 1. `media` / `upload` 的容量上限**收敛而不是拒绝**（前端提交越界值时保存后读回合法值）；
 * 2. 没有提交的段与键保持原样（保存配色不会把媒体上限改回默认值）。
 */

/** 每次都从默认设置拷贝一份，用例之间互不影响。 */
function defaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

test('videoSizeMb 有默认值，且落在合法范围里', () => {
  const media = defaults().media;
  assert.equal(media.videoSizeMb, 50, '默认值变化要同步 app_settings 的读取与文档');
  assert.ok(media.videoSizeMb >= 1 && media.videoSizeMb <= 500);
});

test('videoSizeMb 超出 1..500 时被收敛到边界', () => {
  assert.equal(applyServerPatch(defaults(), { videoSizeMb: 120 }).media.videoSizeMb, 120);
  assert.equal(applyServerPatch(defaults(), { videoSizeMb: 0 }).media.videoSizeMb, 1);
  assert.equal(applyServerPatch(defaults(), { videoSizeMb: -5 }).media.videoSizeMb, 1);
  assert.equal(applyServerPatch(defaults(), { videoSizeMb: 9999 }).media.videoSizeMb, 500);
  assert.equal(applyServerPatch(defaults(), { videoSizeMb: '30' }).media.videoSizeMb, 30, '表单提交的字符串也要能解析');
  assert.equal(
    applyServerPatch(defaults(), { videoSizeMb: 'abc' }).media.videoSizeMb,
    50,
    '解析不出来时保留原值，而不是写成 NaN',
  );
});

test('media 里的其它键不受 videoSizeMb 影响，未提交的段保持原样', () => {
  const current = defaults();
  current.upload = { avatarSizeMb: 3, imageFormats: ['png'], videoFormats: ['mp4'] };
  const next = applyServerPatch(current, { videoSizeMb: 200 });

  assert.equal(next.media.videoSizeMb, 200);
  assert.equal(next.media.imageCount, 8);
  assert.equal(next.media.imageSizeMb, 10);
  assert.equal(next.media.videoCount, 2);
  assert.deepEqual(next.upload, current.upload, '没有提交 upload 时不应被重置');
});

test('头像大小夹在 1..20，头像格式只接受画布能导出的后缀', () => {
  assert.equal(applyServerPatch(defaults(), { avatarSizeMb: 0 }).upload.avatarSizeMb, 1);
  assert.equal(applyServerPatch(defaults(), { avatarSizeMb: 99 }).upload.avatarSizeMb, 20);
  assert.deepEqual(applyServerPatch(defaults(), { avatarFormats: 'png, JPEG' }).upload.avatarFormats, ['png', 'jpeg']);
  assert.throws(() => applyServerPatch(defaults(), { avatarFormats: 'gif' }), /jpg、jpeg、png、webp/);

  const legacy = defaults();
  legacy.upload = { avatarSizeMb: 4, imageFormats: ['png'], videoFormats: ['mp4'] };
  const next = applyServerPatch(legacy, { avatarSizeMb: 6 });
  assert.equal(next.upload.avatarSizeMb, 6);
  assert.deepEqual(next.upload.avatarFormats, ['jpg', 'jpeg', 'png', 'webp'], '老库缺格式时补默认值');
  assert.deepEqual(next.upload.imageFormats, ['png']);
  assert.deepEqual(next.upload.videoFormats, ['mp4']);
});

test('存储上限夹在 64..10240，存满策略只接受两种', () => {
  assert.equal(defaults().upload.storageMb, 1024);
  assert.equal(defaults().upload.whenFull, 'reject');
  assert.equal(applyServerPatch(defaults(), { storageMb: 10 }).upload.storageMb, 64);
  assert.equal(applyServerPatch(defaults(), { storageMb: 99999 }).upload.storageMb, 10240);
  assert.equal(applyServerPatch(defaults(), { storageMb: '128' }).upload.storageMb, 128);
  assert.equal(applyServerPatch(defaults(), { whenFull: 'evict-oldest' }).upload.whenFull, 'evict-oldest');
  assert.equal(applyServerPatch(defaults(), { whenFull: 'wipe' }).upload.whenFull, 'reject');

  const current = defaults();
  current.upload.whenFull = 'evict-oldest';
  const next = applyServerPatch(current, { storageMb: 200 });
  assert.equal(next.upload.storageMb, 200);
  assert.equal(next.upload.whenFull, 'evict-oldest', '没提交的策略保持原值');
});

test('imageSizeMb 仍然是 1..50，且与 videoSizeMb 各自独立收敛', () => {
  const next = applyServerPatch(defaults(), { imageSizeMb: 9999, videoSizeMb: 9999 });
  assert.equal(next.media.imageSizeMb, 50);
  assert.equal(next.media.videoSizeMb, 500);
});

test('老库里缺少 videoSizeMb 时以默认值兜底，不给出 undefined', () => {
  // 模拟「app_settings 里 media 是加这个键之前写入的」：库里那一项只有三个键。
  const legacy = { ...defaults(), media: { imageCount: 8, imageSizeMb: 10, videoCount: 2 } };
  const next = applyServerPatch(legacy, { imageCount: 4 });

  assert.equal(next.media.videoSizeMb, 50, '缺键时补上默认值');
  assert.equal(next.media.imageCount, 4);
});

test('默认色板是 12 种，首色为可下发的钢青，index 0 默认选中它', () => {
  assert.equal(DEFAULT_SETTINGS.theme.colors.length, 12, '配色仍为 12 种');
  assert.deepEqual(DEFAULT_SETTINGS.theme.colors, [...THEME_COLORS]);
  assert.equal(DEFAULT_SETTINGS.theme.colors[0], '#41707E', '首色是钢青');
  assert.equal(DEFAULT_SETTINGS.theme.accentColor, '#41707E', '首色默认值就是钢青');
  assert.equal(DEFAULT_SETTINGS.theme.index, 0, '默认选中首色');
  // 色值必须是 #RRGGBB：前端会直接把它写进 CSS 变量
  for (const color of DEFAULT_SETTINGS.theme.colors) {
    assert.match(color, /^#[0-9A-F]{6}$/, `${color} 不是 #RRGGBB`);
  }
  assert.equal(new Set(DEFAULT_SETTINGS.theme.colors).size, 12, '色板里不能有重复色');
});

test('管理端下发的首色覆盖色板 0；非法色号退回默认', () => {
  const custom = normalizeTheme({ index: 0, accentColor: '#abcdef' });
  assert.equal(custom.accentColor, '#ABCDEF');
  assert.equal(custom.colors[0], '#ABCDEF');
  assert.equal(custom.colors[1], '#C05621', '其余色号顺序不变');
  const fallback = normalizeTheme({ index: 0, accentColor: 'red' });
  assert.equal(fallback.accentColor, '#41707E');
  assert.equal(fallback.colors[0], '#41707E');
});

test('老库的短色板在读取路径上按新顺序归一化，index 仍夹在 0..11', () => {
  const legacy = { index: 3, colors: DEFAULT_SETTINGS.theme.colors.slice(0, 4) };
  const next = normalizeTheme(legacy);

  assert.deepEqual(next.colors, DEFAULT_SETTINGS.theme.colors, '色板顺序以当前默认值为准');
  assert.equal(next.index, 3, 'index 不越界；老用户的旧下标由 0020 迁移平移');

  // 越界（老库被手工改大）时夹到新色板的最后一位，而不是 undefined
  assert.equal(normalizeTheme({ index: 42, colors: legacy.colors }).index, 11);
  assert.equal(normalizeTheme({ index: -1, colors: legacy.colors }).index, 0);
});

test('非法 / 重复 / 缺失 / 超长的颜色都不会让色板长度跑偏', () => {
  const next = normalizeTheme({ index: 5, colors: ['#C05621', '#C05621', 'red', '', null, '#c05621'] });
  assert.equal(next.colors.length, 12, '色板长度固定');
  assert.equal(next.colors[0], '#41707E');
  assert.equal(next.colors[5], DEFAULT_SETTINGS.theme.colors[5]);
  assert.equal(normalizeTheme({ colors: [] }).colors.length, 12, '空色板使用默认色板');
  assert.equal(normalizeTheme({ colors: 'nope' }).colors.length, 12, '非数组也使用默认色板');
  // 缺 colors 的 theme（老到没有这一项）同样可用
  assert.deepEqual(normalizeTheme({ index: 2 }).colors, DEFAULT_SETTINGS.theme.colors);
  // 多于默认色板（手工塞过）时按固定长度下发
  const extra = normalizeTheme({ index: 13, colors: [...DEFAULT_SETTINGS.theme.colors, '#111111', '#222222'] });
  assert.equal(extra.colors.length, 12, '超长色板要被截到默认长度');
  assert.equal(extra.index, 11, 'index 要按截断后的长度夹取');
});

test('管理端色号保存：合法值写入首色，非法值按规则失败', () => {
  const next = applyServerPatch(defaults(), { themeAccent: '#0A0B0C' });
  assert.equal(next.theme.accentColor, '#0A0B0C');
  assert.equal(next.theme.colors[0], '#0A0B0C');
  assert.throws(() => applyServerPatch(defaults(), { themeAccent: '0A0B0C' }), /#RRGGBB/);
  assert.throws(() => applyServerPatch(defaults(), { themeAccent: '#12345' }), /#RRGGBB/);
  assert.equal(applyServerPatch(defaults(), { themeAccent: '#abcdef' }).theme.colors[0], '#ABCDEF');
});

test('收集项的新长度上限缺省时补默认值，提交时按范围收敛', () => {
  const current = defaults();
  delete current.limits.textFill;
  delete current.limits.radioOption;
  delete current.limits.checkOption;
  const untouched = applyServerPatch(current, {});
  assert.equal(untouched.limits.textFill, 200);
  assert.equal(untouched.limits.radioOption, 60);
  assert.equal(untouched.limits.checkOption, 60);
  assert.equal(untouched.limits.fieldTitle, DEFAULT_SETTINGS.limits.fieldTitle, '没提交的旧上限保持原值');
  const next = applyServerPatch(current, { textFill: 80, radioOption: 999, checkOption: 0 });
  assert.equal(next.limits.textFill, 80);
  assert.equal(next.limits.radioOption, 120);
  assert.equal(next.limits.checkOption, 1);
});

test('邀请码时长默认 0（永久），提交时夹到 0..3650 天', () => {
  assert.equal(DEFAULT_SETTINGS.invite.durationDays, 0, '老邀请码与默认生成都是永久');
  const next = applyServerPatch(defaults(), { inviteDurationDays: 30 });
  assert.equal(next.invite.durationDays, 30);
  assert.equal(applyServerPatch(defaults(), { inviteDurationDays: '15' }).invite.durationDays, 15);
  assert.equal(applyServerPatch(defaults(), { inviteDurationDays: 99999 }).invite.durationDays, 3650);
  assert.equal(applyServerPatch(defaults(), { inviteDurationDays: -1 }).invite.durationDays, 0);
  assert.equal(applyServerPatch(defaults(), { inviteDurationDays: 'abc' }).invite.durationDays, 0);
  // 只改次数 / 有效小时时，时长保持原值
  const current = defaults();
  current.invite.durationDays = 45;
  assert.equal(applyServerPatch(current, { inviteUses: 3 }).invite.durationDays, 45);
  assert.equal(applyServerPatch(current, { inviteUses: 3 }).invite.uses, 3);
});

test('下载源默认直链且为空，合法值按段保存', () => {
  assert.deepEqual(DEFAULT_SETTINGS.download, { source: 'url', url: '', repo: '' });
  const next = applyServerPatch(defaults(), {
    download: { source: 'github', url: 'https://example.com/app.apk', repo: 'owner/repo' },
  });
  assert.deepEqual(next.download, {
    source: 'github',
    url: 'https://example.com/app.apk',
    repo: 'owner/repo',
  });
  // 扁平写法与管理端整段提交等价
  assert.deepEqual(
    applyServerPatch(defaults(), {
      downloadSource: 'url',
      downloadUrl: 'http://example.com/app.apk',
      downloadRepo: '',
    }).download,
    { source: 'url', url: 'http://example.com/app.apk', repo: '' },
  );
});

test('下载源的非法值按规则失败，空串合法，未提交的字段保持原值', () => {
  assert.throws(
    () => applyServerPatch(defaults(), { download: { source: 'ftp' } }),
    /下载源只能是直链\/目录或 GitHub 仓库/,
  );
  assert.throws(() => applyServerPatch(defaults(), { downloadUrl: 'example.com/app.apk' }), /http:\/\/ 或 https:\/\//);
  assert.throws(() => applyServerPatch(defaults(), { downloadRepo: 'owner' }), /owner\/repo/);
  assert.throws(() => applyServerPatch(defaults(), { download: 'nope' }), /下载源设置格式不正确/);

  const current = defaults();
  current.download = { source: 'github', url: 'https://example.com/app.apk', repo: 'owner/repo' };
  const next = applyServerPatch(current, { download: { repo: 'new/repo' } });
  assert.deepEqual(next.download, {
    source: 'github',
    url: 'https://example.com/app.apk',
    repo: 'new/repo',
  });
  assert.deepEqual(applyServerPatch(current, { download: { url: '' } }).download, {
    source: 'github',
    url: '',
    repo: 'owner/repo',
  });
});

test('themeIndex 采用补齐后的色板长度夹取', () => {
  const legacy = { ...defaults(), theme: { index: 0, colors: DEFAULT_SETTINGS.theme.colors.slice(0, 4) } };
  // 老库的色板只有 4 项，但提交 7 / 11 应当落在新色板的范围内（补齐后 12 色），而不是被夹到 3
  assert.equal(applyServerPatch(legacy, { themeIndex: 7 }).theme.index, 7);
  assert.equal(applyServerPatch(legacy, { themeIndex: 11 }).theme.index, 11);
  assert.equal(applyServerPatch(legacy, { themeIndex: 99 }).theme.index, 11);
  assert.equal(applyServerPatch(legacy, { themeIndex: 'abc' }).theme.index, 0, '解析不出来时保留原值');
  assert.equal(applyServerPatch(legacy, {}).theme.index, 0, '没提交就不动');
  assert.deepEqual(applyServerPatch(legacy, {}).theme.colors, DEFAULT_SETTINGS.theme.colors);
});

/**
 * 个人配色（`users.ui_theme`）与全局默认不同：越界**不夹取**，按规则失败。
 *
 * 这几条都在 `query()` 之前抛错，因此不连数据库也能跑（unit 项目不碰库）；
 * 合法值落库与 bootstrap 生效由契约测试覆盖（`server/src/test/`）。
 */
test('个人配色的非法下标按规则失败，不静默夹取', async () => {
  await assert.rejects(() => saveUiTheme(null, 3), /请先登录/, '未登录不能写个人配色');
  await assert.rejects(() => saveUiTheme(undefined, 3), /请先登录/, '未登录不能写个人配色');
  for (const bad of [99, -1, 12, 1.5, 'abc', '', '2abc', null, undefined, {}]) {
    await assert.rejects(
      () => saveUiTheme('usr-3', bad),
      /配色下标/,
      `下标 ${JSON.stringify(bad)} 应当被拒绝而不是夹取到边界`,
    );
  }
  // 合法值（含字符串 '3'）会走到 UPDATE，unit 项目不连库，因此由契约测试覆盖。
});

/**
 * 用户协议：开启必须有正文；正文变化才升版本（只拨开关不升），超出长度按业务失败拒绝。
 * 落库与接口行为由契约测试覆盖（`server/src/test/agreement.test.ts`）。
 */
test('用户协议开启时正文必填，正文变化才升版本', () => {
  assert.throws(
    () => applyServerPatch(defaults(), { agreement: { enabled: true, content: '' } }),
    /开启用户协议前请先上传/,
  );
  assert.throws(
    () => applyServerPatch(defaults(), { agreement: { enabled: true } }),
    /开启用户协议前请先上传/,
    '只打开开关、库里又没有旧正文时也要拒绝',
  );

  const first = applyServerPatch(defaults(), { agreement: { enabled: true, content: '# 条款 第一条' } });
  assert.equal(first.agreement.enabled, true);
  assert.equal(first.agreement.version, 1);
  assert.ok(first.agreement.updatedAt.length > 0, '首次设置正文要写更新时间');

  const same = applyServerPatch(first, { agreement: { enabled: true, content: '# 条款 第一条' } });
  assert.equal(same.agreement.version, 1);

  const disabled = applyServerPatch(same, { agreement: { enabled: false } });
  assert.equal(disabled.agreement.version, 1);
  assert.equal(disabled.agreement.content, '# 条款 第一条');

  const updated = applyServerPatch(disabled, { agreement: { content: '# 条款 v2' } });
  assert.equal(updated.agreement.version, 2);
  assert.equal(updated.agreement.content, '# 条款 v2');
  // CI 上两次保存可能落在同一毫秒，不能要求时间戳严格不同；但更新后不能倒退。
  assert.ok(updated.agreement.updatedAt >= first.agreement.updatedAt, '更新时间不能倒退');
});

test('用户协议非法入参与超长正文按业务失败返回', () => {
  assert.throws(() => applyServerPatch(defaults(), { agreement: 'x' }), /格式不正确/);
  assert.throws(
    () => applyServerPatch(defaults(), { agreement: { enabled: 'yes', content: 'x' } }),
    /只能是 true 或 false/,
  );
  assert.throws(
    () => applyServerPatch(defaults(), { agreement: { enabled: true, content: 'x'.repeat(200_001) } }),
    /正文过长/,
  );
  assert.equal(applyServerPatch(defaults(), {}).agreement.enabled, false, '没提交就不动');
});

/**
 * 操作日志存储上限：夹到 1～10240 MB，不静默写成 0 或超大值。
 * 落库与清理行为由契约测试覆盖（`server/src/test/logs.test.ts`）。
 */
test('日志存储上限收敛到 1～10240 MB', () => {
  assert.equal(applyServerPatch(defaults(), { logs: { storageMb: 128 } }).logs.storageMb, 128);
  assert.equal(applyServerPatch(defaults(), { logs: { storageMb: 0 } }).logs.storageMb, 1);
  assert.equal(applyServerPatch(defaults(), { logs: { storageMb: -5 } }).logs.storageMb, 1);
  assert.equal(applyServerPatch(defaults(), { logs: { storageMb: 99999 } }).logs.storageMb, 10240);
  assert.equal(applyServerPatch(defaults(), { logsStorageMb: 512 }).logs.storageMb, 512, '扁平写法也认');
  assert.equal(applyServerPatch(defaults(), {}).logs.storageMb, 64, '默认保留 64 MB');
  assert.throws(() => applyServerPatch(defaults(), { logs: 'x' }), /格式不正确/);
});

/** 展商策略：单个展会最长持续天数 0～365，0 表示不限（与前端表单上限一致）。 */
test('单个展会最大持续天数收敛到 0～365', () => {
  assert.equal(applyServerPatch(defaults(), { maxExhibitionDays: 7 }).exhibitor.maxExhibitionDays, 7);
  assert.equal(applyServerPatch(defaults(), { maxExhibitionDays: 0 }).exhibitor.maxExhibitionDays, 0);
  assert.equal(applyServerPatch(defaults(), { maxExhibitionDays: -5 }).exhibitor.maxExhibitionDays, 0);
  assert.equal(applyServerPatch(defaults(), { maxExhibitionDays: 999 }).exhibitor.maxExhibitionDays, 365);
  assert.equal(applyServerPatch(defaults(), {}).exhibitor.maxExhibitionDays, 0, '默认不限');
});
