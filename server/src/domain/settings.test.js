const assert = require('node:assert/strict');

const { DEFAULT_SETTINGS } = require('../config/migrate');
const { applyServerPatch } = require('./settings');

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
