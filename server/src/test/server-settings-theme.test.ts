/**
 * 服务器设置与色板 契约测试。
 *
 * 设置仅管理员可改、老库 4 色 / 坏值色板的夹取、个人配色与全局默认、视频与封面额度、外观模式。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import { migrate, DEFAULT_SETTINGS } from '../config/migrate.js';
import { pool } from '../config/pool.js';
import { get, put, startContract, stopContract, tokens } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

test('服务器设置只有管理员能改，保存后可读回', async () => {
  const asUser = await put('/api/v1/settings', { appTitleZh: 'x' }, { token: tokens.user.token });
  assert.strictEqual(asUser.status, 403);

  // 色板是 8 种，且 index 0 仍是默认的焦糖橙（老用户的强调色不能变）
  const paletteBefore = await get('/api/v1/settings');
  assert.strictEqual(paletteBefore.body.theme.colors.length, DEFAULT_SETTINGS.theme.colors.length);
  assert.strictEqual(paletteBefore.body.theme.colors.length, 8, '配色面板要有 8 个色块');
  assert.strictEqual(paletteBefore.body.theme.colors[0], '#C05621', 'index 0 必须还是默认的焦糖橙');
  assert.deepStrictEqual(
    paletteBefore.body.theme.colors,
    DEFAULT_SETTINGS.theme.colors,
    'settings 与 bootstrap 下发的色板要一致',
  );

  const saved = await put(
    '/api/v1/settings',
    {
      appTitleZh: '展会助手',
      appTitleEn: 'ExpoHub',
      canRevise: true,
      themeIndex: 2,
      categories: ['智能家居', '新材料'],
      exhibitionTitle: 80,
    },
    { token: tokens.admin.token },
  );
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.settings.brand.zh, '展会助手');
  assert.strictEqual(saved.body.settings.theme.index, 2);
  assert.strictEqual(saved.body.settings.theme.colors[2], DEFAULT_SETTINGS.theme.colors[2]);
  assert.strictEqual(saved.body.settings.review.canRevise, true);
  assert.strictEqual(saved.body.settings.limits.exhibitionTitle, 80);

  const read = await get('/api/v1/settings');
  assert.strictEqual(read.body.brand.zh, '展会助手');
  assert.strictEqual(read.body.limits.exhibitionTitle, 80);

  // 上限收敛：超界值被夹到范围内，而不是原样写入
  const clamped = await put('/api/v1/settings', { exhibitionTitle: 9999 }, { token: tokens.admin.token });
  assert.strictEqual(clamped.body.settings.limits.exhibitionTitle, 120);

  // 配色下标同理：超出色板长度时夹到最后一个，而不是原样写入
  const overflow = await put('/api/v1/settings', { themeIndex: 99 }, { token: tokens.admin.token });
  assert.strictEqual(overflow.body.settings.theme.index, 7, '99 应当被夹到 8 色色板的最后一位');
  const negative = await put('/api/v1/settings', { themeIndex: -3 }, { token: tokens.admin.token });
  assert.strictEqual(negative.body.settings.theme.index, 0, '负数应当夹到 0');

  // 没提交的段不应被重置
  assert.strictEqual(clamped.body.settings.brand.zh, '展会助手');

  // 还原
  await put(
    '/api/v1/settings',
    {
      appTitleZh: '发现展会',
      canRevise: false,
      themeIndex: 0,
      exhibitionTitle: 60,
    },
    { token: tokens.admin.token },
  );
});

test('老库的 4 色色板：迁移补到 8 色，且已有的 index 不变', async () => {
  // 模拟老库：迁移 0006 之前写入的 theme 只有 4 个颜色
  const legacyColors = DEFAULT_SETTINGS.theme.colors.slice(0, 4);
  const legacy = { index: 3, colors: legacyColors };
  await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [JSON.stringify(legacy), 'theme']);
  try {
    // 迁移是幂等的：再跑一次也应当把色板补到 8 色
    await migrate();

    const bootstrap = await get('/api/v1/bootstrap');
    assert.deepStrictEqual(
      bootstrap.body.theme.colors,
      DEFAULT_SETTINGS.theme.colors,
      `迁移后必须是新的 8 色色板：${JSON.stringify(bootstrap.body.theme.colors)}`,
    );
    assert.strictEqual(bootstrap.body.theme.index, 3, '已有用户选中的 index 不能被迁移改掉');
    assert.strictEqual(bootstrap.body.theme.colors[3], legacyColors[3], 'index 3 的色值语义保持不变');

    const settings = await get('/api/v1/settings');
    assert.deepStrictEqual(settings.body.theme.colors, DEFAULT_SETTINGS.theme.colors);
    assert.strictEqual(settings.body.theme.index, 3);
  } finally {
    await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
      JSON.stringify(DEFAULT_SETTINGS.theme),
      'theme',
    ]);
  }
});

test('老库色板被手工改坏（非法值 / 重复值）时，读取与夹取仍按 8 色色板', async () => {
  await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
    JSON.stringify({ index: 6, colors: ['#C05621', 'not-a-color', '#C05621', null] }),
    'theme',
  ]);
  try {
    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(bootstrap.body.theme.colors.length, 8, '非法与重复的颜色应当被丢掉后补齐');
    assert.strictEqual(bootstrap.body.theme.colors[0], '#C05621', '库里的合法项要保留');
    assert.strictEqual(bootstrap.body.theme.index, 6, 'index 落在补齐后的范围里，应当保留');
    assert.strictEqual(bootstrap.body.theme.colors[6], DEFAULT_SETTINGS.theme.colors[6]);

    // index 超界时按补齐后的长度夹取
    await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
      JSON.stringify({ index: 42, colors: ['#C05621', '#48515D', '#245D3C', '#2F6F8F'] }),
      'theme',
    ]);
    const clamped = await get('/api/v1/settings');
    assert.strictEqual(clamped.body.theme.index, 7, '老库的越界 index 要夹到 8 色色板的最后一位');
  } finally {
    await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
      JSON.stringify(DEFAULT_SETTINGS.theme),
      'theme',
    ]);
  }
});

test('个人配色按账号保存：没有个人选择时跟随全局默认', async () => {
  await pool.query('UPDATE users SET ui_theme = NULL');

  const anonymous = await put('/api/v1/settings/ui-theme', { themeIndex: 3 });
  assert.strictEqual(anonymous.status, 401, '未登录不能保存个人配色');

  // 全局默认随服务器设置走，个人没选过就用它
  const global = (await get('/api/v1/settings')).body.theme.index;
  const bootstrap = await get('/api/v1/bootstrap', { token: tokens.user.token });
  assert.strictEqual(bootstrap.body.theme.index, global, '没选过配色时应当跟随全局默认');
  assert.deepStrictEqual(bootstrap.body.theme.colors, DEFAULT_SETTINGS.theme.colors, '色板仍是补齐后的 8 色');
});

test('普通用户设置的配色在自己的 bootstrap 生效，且不串到别人身上', async () => {
  await pool.query('UPDATE users SET ui_theme = NULL');

  const saved = await put('/api/v1/settings/ui-theme', { themeIndex: 5 }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.themeIndex, 5);

  const mine = await get('/api/v1/bootstrap', { token: tokens.user.token });
  assert.strictEqual(mine.body.theme.index, 5, '普通用户的个人配色要在 bootstrap 生效');
  assert.strictEqual(mine.body.theme.colors[5], DEFAULT_SETTINGS.theme.colors[5]);
  assert.strictEqual((await get('/api/v1/settings', { token: tokens.user.token })).body.theme.index, 5);

  // 别人不受影响（该账号没选过 → 跟随全局默认）
  const other = await get('/api/v1/bootstrap', { token: tokens.exhibitor.token });
  assert.notStrictEqual(other.body.theme.index, 5, '个人配色不能串到别的账号');

  // 越界 / 非整数是规则失败（200 + ok:false），不是静默夹取
  const tooLarge = await put('/api/v1/settings/ui-theme', { themeIndex: 99 }, { token: tokens.user.token });
  assert.strictEqual(tooLarge.status, 200);
  assert.strictEqual(tooLarge.body.ok, false, '越界下标应当按规则失败');
  assert.ok(tooLarge.body.error, '规则失败要给出可展示的原因');
  const notNumber = await put('/api/v1/settings/ui-theme', { themeIndex: 'abc' }, { token: tokens.user.token });
  assert.strictEqual(notNumber.body.ok, false);
  const negative = await put('/api/v1/settings/ui-theme', { themeIndex: -1 }, { token: tokens.user.token });
  assert.strictEqual(negative.body.ok, false);
  assert.strictEqual(
    (await get('/api/v1/bootstrap', { token: tokens.user.token })).body.theme.index,
    5,
    '失败的下标不能改写已保存的个人配色',
  );
});

test('管理员改全局默认只影响没选过配色的账号', async () => {
  await pool.query('UPDATE users SET ui_theme = NULL');
  const global = (await get('/api/v1/settings')).body.theme.index;

  // 普通用户选了自己的配色
  const saved = await put('/api/v1/settings/ui-theme', { themeIndex: 5 }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));

  try {
    // 管理员改「管理-设置」里的全局默认
    const changed = await put('/api/v1/settings', { themeIndex: 2 }, { token: tokens.admin.token });
    assert.strictEqual(changed.body.settings.theme.index, 2, '管理员自己的生效下标要变成新的全局默认');

    const mine = await get('/api/v1/bootstrap', { token: tokens.user.token });
    assert.strictEqual(mine.body.theme.index, 5, '已选过配色的账号不受全局默认影响');

    // 没选过的账号（exhibitor）跟着全局默认走
    const follower = await get('/api/v1/bootstrap', { token: tokens.exhibitor.token });
    assert.strictEqual(follower.body.theme.index, 2, '没选过的账号要跟随新的全局默认');

    // 管理员自己也没选过个人配色 → 读到的就是全局默认
    const admin = await get('/api/v1/bootstrap', { token: tokens.admin.token });
    assert.strictEqual(admin.body.theme.index, 2);
  } finally {
    await put('/api/v1/settings', { themeIndex: global }, { token: tokens.admin.token });
    // 个人配色是账号级数据，测试账号之间共用，跑完要清掉，避免影响后续用例
    await pool.query('UPDATE users SET ui_theme = NULL');
  }
});

test('视频大小上限可配置，bootstrap 与 settings 读回同一个值，越界被收敛', async () => {
  // 老库（app_settings 里还没有 videoSizeMb）也要能拿到默认值，而不是 undefined
  const bootstrapBefore = await get('/api/v1/bootstrap');
  assert.ok(
    Number(bootstrapBefore.body.media.videoSizeMb) > 0,
    `bootstrap 的 media 必须带 videoSizeMb：${JSON.stringify(bootstrapBefore.body.media)}`,
  );
  const settingsBefore = await get('/api/v1/settings');
  const defaultSize = Number(settingsBefore.body.media.videoSizeMb);
  const imageSizeBefore = Number(settingsBefore.body.media.imageSizeMb);
  assert.strictEqual(
    Number(bootstrapBefore.body.media.videoSizeMb),
    defaultSize,
    'bootstrap 与 settings 的 media 来自同一份 payload，值必须一致',
  );

  try {
    const saved = await put('/api/v1/settings', { videoSizeMb: 120 }, { token: tokens.admin.token });
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.settings.media.videoSizeMb, 120, '保存结果里应当带上新的上限');

    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(Number(bootstrap.body.media.videoSizeMb), 120, 'bootstrap 应当读回新的上限');
    const settings = await get('/api/v1/settings');
    assert.strictEqual(Number(settings.body.media.videoSizeMb), 120, 'settings 应当读回新的上限');
    // 同一段里的其它键不受影响
    assert.strictEqual(Number(settings.body.media.imageSizeMb), imageSizeBefore);

    const tooSmall = await put('/api/v1/settings', { videoSizeMb: 0 }, { token: tokens.admin.token });
    assert.strictEqual(tooSmall.body.settings.media.videoSizeMb, 1, '0 应当被夹到下限 1');
    const tooLarge = await put('/api/v1/settings', { videoSizeMb: 9999 }, { token: tokens.admin.token });
    assert.strictEqual(tooLarge.body.settings.media.videoSizeMb, 500, '9999 应当被夹到上限 500');
    assert.strictEqual(Number((await get('/api/v1/bootstrap')).body.media.videoSizeMb), 500);
  } finally {
    await put('/api/v1/settings', { videoSizeMb: defaultSize }, { token: tokens.admin.token });
  }
});

test('缺省展会封面与展商展会数上限：保存后 bootstrap 与 settings 都能读回', async () => {
  const before = await get('/api/v1/settings');
  const coverBefore = String(before.body.cover?.defaultCover ?? '');
  const limitBefore = Number(before.body.exhibitor?.maxFutureExhibitions ?? 0);
  try {
    const saved = await put(
      '/api/v1/settings',
      { defaultCover: 'https://cdn.example.com/default-cover.jpg', maxFutureExhibitions: 3 },
      { token: tokens.admin.token },
    );
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.strictEqual(saved.body.settings.cover.defaultCover, 'https://cdn.example.com/default-cover.jpg');
    assert.strictEqual(Number(saved.body.settings.exhibitor.maxFutureExhibitions), 3);

    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(
      bootstrap.body.cover.defaultCover,
      'https://cdn.example.com/default-cover.jpg',
      'bootstrap 要带上缺省封面（列表与详情据此兜底）',
    );
    assert.strictEqual(Number(bootstrap.body.exhibitor.maxFutureExhibitions), 3);

    // 形状不对的封面地址按规则失败（200 + ok:false），空串表示回到占位图
    const badCover = await put('/api/v1/settings', { defaultCover: 'not-a-url' }, { token: tokens.admin.token });
    assert.strictEqual(badCover.body.ok, false, '非法封面地址应当被拒绝');
    const cleared = await put('/api/v1/settings', { defaultCover: '' }, { token: tokens.admin.token });
    assert.strictEqual(cleared.body.settings.cover.defaultCover, '');

    // 上限夹到 0..100（0 = 不限）
    const clamped = await put('/api/v1/settings', { maxFutureExhibitions: 999 }, { token: tokens.admin.token });
    assert.strictEqual(Number(clamped.body.settings.exhibitor.maxFutureExhibitions), 100);
  } finally {
    await put(
      '/api/v1/settings',
      { defaultCover: coverBefore, maxFutureExhibitions: limitBefore },
      { token: tokens.admin.token },
    );
  }
});
test('老库的 app_settings.media 缺 videoSizeMb 时用默认值兜底', async () => {
  // 直接写一条「加这个键之前」的 media：只有三个键，没有任何 videoSizeMb
  await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
    JSON.stringify({ imageCount: 6, imageSizeMb: 4, videoCount: 1 }),
    'media',
  ]);
  try {
    const bootstrap = await get('/api/v1/bootstrap');
    assert.strictEqual(
      bootstrap.body.media.videoSizeMb,
      DEFAULT_SETTINGS.media.videoSizeMb,
      `缺键时应当补默认值，而不是 undefined：${JSON.stringify(bootstrap.body.media)}`,
    );
    assert.strictEqual(bootstrap.body.media.imageCount, 6, '库里已有的键照旧生效');
    const settings = await get('/api/v1/settings');
    assert.strictEqual(settings.body.media.videoSizeMb, DEFAULT_SETTINGS.media.videoSizeMb);
  } finally {
    await pool.query('UPDATE app_settings SET value = $1::jsonb WHERE key = $2', [
      JSON.stringify(DEFAULT_SETTINGS.media),
      'media',
    ]);
  }
});

test('外观模式只接受三个取值，且是个人偏好', async () => {
  // 未登录不能写：以前这里是 optionalAuth，匿名请求会把取值写成所有用户的默认外观。
  const defaultBefore = await get('/api/v1/settings');
  const anonymous = await put('/api/v1/settings/ui-mode', { mode: 'dark' });
  assert.strictEqual(anonymous.status, 401, '未登录不能修改外观模式');
  assert.ok(anonymous.body.error, '401 要带可展示的原因');
  const defaultAfter = await get('/api/v1/settings');
  assert.strictEqual(defaultAfter.body.ui.mode, defaultBefore.body.ui.mode, '匿名请求不能改掉服务器级的默认外观');

  const dark = await put('/api/v1/settings/ui-mode', { mode: 'dark' }, { token: tokens.admin.token });
  assert.strictEqual(dark.body.mode, 'dark');
  const mine = await get('/api/v1/settings', { token: tokens.admin.token });
  assert.strictEqual(mine.body.ui.mode, 'dark', '个人外观模式应当被记住');

  // 另一个用户不受影响
  const other = await get('/api/v1/settings', { token: tokens.user.token });
  assert.notStrictEqual(other.body.ui.mode, 'dark', '外观模式不应该串到别人身上');

  const invalid = await put('/api/v1/settings/ui-mode', { mode: '乱填' }, { token: tokens.admin.token });
  assert.strictEqual(invalid.body.mode, 'auto');
  await put('/api/v1/settings/ui-mode', { mode: 'auto' }, { token: tokens.admin.token });
});
