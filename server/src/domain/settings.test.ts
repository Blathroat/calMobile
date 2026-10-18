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

test('默认色板是 12 种，index 0 仍是老用户的焦糖橙', () => {
  assert.equal(DEFAULT_SETTINGS.theme.colors.length, 12, '配色扩到 12 种');
  assert.deepEqual(DEFAULT_SETTINGS.theme.colors, [...THEME_COLORS]);
  assert.equal(DEFAULT_SETTINGS.theme.colors[0], '#C05621', 'index 0 的语义不能变');
  assert.equal(DEFAULT_SETTINGS.theme.index, 0);
  // 色值必须是 #RRGGBB：前端会直接把它写进 CSS 变量
  for (const color of DEFAULT_SETTINGS.theme.colors) {
    assert.match(color, /^#[0-9A-F]{6}$/, `${color} 不是 #RRGGBB`);
  }
  assert.equal(new Set(DEFAULT_SETTINGS.theme.colors).size, 12, '色板里不能有重复色');
});

test('老库的 4 色色板在读取路径上被补齐到 12 色，index 不越界', () => {
  // 老库：只有旧色板的 4 项，index 3 是当时合法的选择
  const legacy = { index: 3, colors: DEFAULT_SETTINGS.theme.colors.slice(0, 4) };
  const next = normalizeTheme(legacy);

  assert.deepEqual(next.colors, DEFAULT_SETTINGS.theme.colors, '保留已有项、按默认色板追加新色');
  assert.equal(next.index, 3, 'index 不变，老用户选中的强调色不动');

  // 越界（老库被手工改大）时夹到补齐后的最后一位，而不是 undefined
  assert.equal(normalizeTheme({ index: 42, colors: legacy.colors }).index, 11);
  assert.equal(normalizeTheme({ index: -1, colors: legacy.colors }).index, 0);
});

test('非法 / 重复 / 缺失 / 超长的颜色都不会让色板长度跑偏', () => {
  const next = normalizeTheme({ index: 5, colors: ['#C05621', '#C05621', 'red', '', null, '#c05621'] });
  assert.equal(next.colors.length, 12, '非法与重复项被丢掉后要补齐');
  assert.equal(next.colors[0], '#C05621');
  assert.equal(next.colors[5], DEFAULT_SETTINGS.theme.colors[5]);
  assert.equal(normalizeTheme({ colors: [] }).colors.length, 12, '空色板退回默认色板');
  assert.equal(normalizeTheme({ colors: 'nope' }).colors.length, 12, '非数组也退回默认色板');
  // 缺 colors 的 theme（老到没有这一项）同样可用
  assert.deepEqual(normalizeTheme({ index: 2 }).colors, DEFAULT_SETTINGS.theme.colors);
  // 多于默认色板（手工塞过）时只取前 12 个，index 的范围与长度始终一致
  const extra = normalizeTheme({ index: 13, colors: [...DEFAULT_SETTINGS.theme.colors, '#111111', '#222222'] });
  assert.equal(extra.colors.length, 12, '超长色板要被截到默认长度');
  assert.equal(extra.index, 11, 'index 要按截断后的长度夹取');
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
