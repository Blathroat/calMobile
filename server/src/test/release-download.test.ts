/**
 * 更新检查 / 下载源 契约测试。
 *
 * 覆盖：公开的版本接口形状、管理员保存下载源的校验（非法值 200 + ok:false）、
 * 设置 / 启动数据 / 版本接口三处读到同一份下载信息。
 * GitHub 真实接口不在这条链路上：仓库为空时不发请求，解析与缓存由 unit 用例覆盖。
 */

import assert from 'node:assert/strict';
import { pool } from '../config/pool.js';
import { get, login, put, startContract, stopContract } from './contract-harness.js';

beforeAll(startContract);
afterAll(async () => {
  // 恢复默认下载源（模板库 seed 过 DEFAULT_SETTINGS.download）。
  await pool.query("DELETE FROM app_settings WHERE key = 'download'");
  await stopContract();
});

const DOWNLOAD = { source: 'url', url: 'https://example.com/app.apk', repo: '' };

test('版本接口公开可用：默认走直链且地址为空，bootstrap 带同一份摘要', async () => {
  const release = await get('/api/v1/app/release');
  assert.strictEqual(release.status, 200);
  assert.strictEqual(release.body.ok, true);
  assert.strictEqual(release.body.source, 'url');
  assert.strictEqual(release.body.version, '');
  assert.strictEqual(release.body.notes, '');
  assert.strictEqual(release.body.url, '');
  assert.strictEqual(release.body.publishedAt, '');
  assert.match(String(release.headers?.['cache-control'] || ''), /no-store/);

  const bootstrap = await get('/api/v1/bootstrap');
  assert.deepStrictEqual(bootstrap.body.download, { source: 'url', version: '', url: '' });
});

test('保存下载源：权限、非法值拒绝、合法值同步到设置 / 版本 / 启动数据', async () => {
  const admin = await login('demo');
  const user = await login('user');

  const anonymous = await put('/api/v1/settings', { download: DOWNLOAD });
  assert.strictEqual(anonymous.status, 401);
  const forbidden = await put('/api/v1/settings', { download: DOWNLOAD }, { token: user.token });
  assert.strictEqual(forbidden.status, 403);

  const badSource = await put('/api/v1/settings', { download: { source: 'ftp' } }, { token: admin.token });
  assert.strictEqual(badSource.status, 200);
  assert.strictEqual(badSource.body.ok, false);
  assert.strictEqual(badSource.body.errorCode, 'settings.downloadSourceInvalid');

  const badUrl = await put('/api/v1/settings', { downloadUrl: 'example.com/app.apk' }, { token: admin.token });
  assert.strictEqual(badUrl.body.ok, false);
  assert.strictEqual(badUrl.body.errorCode, 'settings.downloadUrlInvalid');

  const badRepo = await put('/api/v1/settings', { download: { repo: 'owner-only' } }, { token: admin.token });
  assert.strictEqual(badRepo.body.ok, false);
  assert.strictEqual(badRepo.body.errorCode, 'settings.downloadRepoInvalid');

  const saved = await put('/api/v1/settings', { download: DOWNLOAD }, { token: admin.token });
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.deepStrictEqual(saved.body.settings.download, DOWNLOAD);

  const settings = await get('/api/v1/settings');
  assert.deepStrictEqual(settings.body.download, DOWNLOAD);

  const release = await get('/api/v1/app/release');
  assert.strictEqual(release.body.ok, true);
  assert.strictEqual(release.body.source, 'url');
  assert.strictEqual(release.body.url, DOWNLOAD.url);

  const bootstrap = await get('/api/v1/bootstrap');
  assert.deepStrictEqual(bootstrap.body.download, { source: 'url', version: '', url: DOWNLOAD.url });
});

test('GitHub 源且仓库为空时返回空地址，不请求外部接口', async () => {
  const admin = await login('demo');
  const saved = await put(
    '/api/v1/settings',
    { download: { source: 'github', url: '', repo: '' } },
    { token: admin.token },
  );
  assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
  assert.deepStrictEqual(saved.body.settings.download, { source: 'github', url: '', repo: '' });

  const release = await get('/api/v1/app/release');
  assert.strictEqual(release.body.source, 'github');
  assert.strictEqual(release.body.url, '');
  assert.strictEqual(release.body.version, '');
});
