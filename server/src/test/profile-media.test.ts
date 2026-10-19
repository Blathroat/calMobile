/**
 * 资料与媒体 契约测试。
 *
 * 头像与展会媒体上传（大小 / 格式 / 清理）、资料字段保存、改密码需身份复核、通知偏好。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  del,
  get,
  identityTicket,
  login,
  post,
  put,
  serverPort,
  startContract,
  stopContract,
  tokens,
  type HttpResponse,
} from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 8×8 的最小 JPEG：带 SOI、SOF0 和 EOI，上传校验认得出。 */
function minimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function requestBytes(
  method: string,
  requestPath: string,
  payload: Buffer,
  { token, headers = {} }: { token?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse & { raw: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: serverPort(),
        path: requestPath,
        method,
        headers: {
          ...headers,
          'Content-Length': String(payload.length),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let body: unknown = raw.toString('utf8');
          try {
            body = JSON.parse(String(body));
          } catch {
            // 图片响应保持原始字节，JSON 字段用不到
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers, raw });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

test('头像上传落到服务器，并遵守大小与格式设置', async () => {
  const previousDir = process.env.UPLOAD_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-avatar-'));
  process.env.UPLOAD_DIR = directory;
  const jpeg = minimalJpeg();
  try {
    const anonymous = await requestBytes('POST', '/api/v1/profile/avatar', jpeg, {
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(anonymous.status, 401);

    const uploaded = await requestBytes('POST', '/api/v1/profile/avatar', jpeg, {
      token: tokens.user.token,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(uploaded.status, 200);
    assert.strictEqual(uploaded.body.ok, true, JSON.stringify(uploaded.body));
    const url = String(uploaded.body.url);
    assert.match(url, /^\/media\/avatars\/[a-f0-9]{32}\.jpg$/);
    assert.strictEqual(uploaded.body.user.avatar, url);

    const image = await requestBytes('GET', url, Buffer.alloc(0));
    assert.strictEqual(image.status, 200);
    assert.strictEqual(image.headers?.['content-type'], 'image/jpeg');
    assert.strictEqual(image.headers?.['cross-origin-resource-policy'], 'cross-origin');
    assert.ok(image.raw.equals(jpeg));

    const replaced = await put(
      '/api/v1/profile',
      { avatar: 'https://appassets.androidplatform.net/media/local.jpg' },
      {
        token: tokens.user.token,
      },
    );
    assert.strictEqual(replaced.body.ok, false);
    const kept = await get('/api/v1/profile', { token: tokens.user.token });
    assert.strictEqual(kept.body.avatar, url, '资料保存不能把设备路径写回头像');

    const narrowed = await put('/api/v1/settings', { avatarFormats: 'png' }, { token: tokens.admin.token });
    assert.strictEqual(narrowed.body.ok, true, JSON.stringify(narrowed.body));
    const rejected = await requestBytes('POST', '/api/v1/profile/avatar', jpeg, {
      token: tokens.user.token,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.body.ok, false);
    assert.match(String(rejected.body.error), /不允许上传 \.jpg/);
    // 带变量的抛出文案：码 + 占位值一起下发
    assert.strictEqual(rejected.body.errorCode, 'profile.avatarFormatRejected');
    assert.deepEqual(rejected.body.errorParams, { ext: 'jpg', formats: 'png' });

    const bogus = await put('/api/v1/settings', { avatarFormats: 'gif' }, { token: tokens.admin.token });
    assert.strictEqual(bogus.body.ok, false);
    assert.match(String(bogus.body.error), /jpg、jpeg、png、webp/);

    const restored = await put(
      '/api/v1/settings',
      { avatarFormats: 'jpg,jpeg,png,webp' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(restored.body.ok, true);
    const removed = await del('/api/v1/profile/avatar', { token: tokens.user.token });
    assert.strictEqual(removed.body.ok, true);
    assert.strictEqual(removed.body.user.avatar, '');
    const gone = await requestBytes('GET', url, Buffer.alloc(0));
    assert.strictEqual(gone.status, 404);
  } finally {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
    await put('/api/v1/settings', { avatarFormats: 'jpg,jpeg,png,webp' }, { token: tokens.admin.token }).catch(
      () => undefined,
    );
    await del('/api/v1/profile/avatar', { token: tokens.user.token }).catch(() => undefined);
  }
});

test('展会媒体上传到服务器，打不开或不再引用的文件会被清掉', async () => {
  const previousDir = process.env.UPLOAD_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-media-'));
  process.env.UPLOAD_DIR = directory;
  const jpeg = minimalJpeg();
  const linkedName = `${'b'.repeat(32)}.jpg`;
  const orphanName = `${'c'.repeat(32)}.jpg`;
  const linkedUrl = `/media/files/${linkedName}`;
  const filesDir = path.join(directory, 'files');
  let exhibitionId = '';
  const exists = async (target: string) => {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const anonymous = await requestBytes('POST', '/api/v1/media?kind=image', jpeg, {
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(anonymous.status, 401);

    const asUser = await requestBytes('POST', '/api/v1/media?kind=image', jpeg, {
      token: tokens.user.token,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(asUser.status, 403);

    const uploaded = await requestBytes('POST', '/api/v1/media?kind=image', jpeg, {
      token: tokens.exhibitor.token,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.strictEqual(uploaded.status, 200);
    assert.strictEqual(uploaded.body.ok, true, JSON.stringify(uploaded.body));
    const url = String(uploaded.body.url);
    assert.match(url, /^\/media\/files\/[a-f0-9]{32}\.jpg$/);
    const image = await requestBytes('GET', url, Buffer.alloc(0));
    assert.strictEqual(image.status, 200);
    assert.strictEqual(image.headers?.['content-type'], 'image/jpeg');
    assert.strictEqual(image.headers?.['cross-origin-resource-policy'], 'cross-origin');
    assert.ok(image.raw.equals(jpeg));

    await mkdir(filesDir, { recursive: true });
    const linkedPath = path.join(filesDir, linkedName);
    await writeFile(linkedPath, jpeg);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(linkedPath, old, old);
    const created = await post(
      '/api/v1/exhibitions',
      {
        title: '媒体清理测试',
        venue: '测试展馆',
        time: '09:00-17:00',
        date: '2026-09-20',
        status: 'review',
        category: '智能家居',
        description: `![图](${linkedUrl})`,
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(created.body.ok, true, JSON.stringify(created.body));
    exhibitionId = String(created.body.exhibition.id);

    const orphanPath = path.join(filesDir, orphanName);
    await writeFile(orphanPath, jpeg);
    await utimes(orphanPath, old, old);
    assert.equal(await exists(orphanPath), true);

    const settings = await get('/api/v1/settings', { token: tokens.admin.token });
    assert.equal(await exists(orphanPath), false, '超过一小时且没人引用的文件应被清掉');
    assert.equal(await exists(linkedPath), true, '仍被简介引用的文件要留下');
    assert.equal(
      await exists(path.join(filesDir, url.slice(url.lastIndexOf('/') + 1))),
      true,
      '刚上传、还没写进正文的文件先留着',
    );
    assert.equal(settings.body.storage.whenFull, 'reject');
    assert.equal(settings.body.storage.fileCount, 2);
    assert.equal(settings.body.storage.usedBytes, jpeg.length * 2);
    assert.equal(settings.body.storage.limitBytes, 1024 * 1024 * 1024);
    const viewer = await get('/api/v1/settings', { token: tokens.user.token });
    assert.equal(viewer.body.storage, undefined);

    const cleared = await put(
      `/api/v1/exhibitions/${exhibitionId}`,
      {
        title: '媒体清理测试',
        description: '清理后',
      },
      { token: tokens.exhibitor.token },
    );
    assert.strictEqual(cleared.body.ok, true, JSON.stringify(cleared.body));
    assert.equal(await exists(linkedPath), false, '从简介里拿掉的文件应马上删除');

    const saved = await put(
      '/api/v1/settings',
      { storageMb: 128, whenFull: 'evict-oldest' },
      { token: tokens.admin.token },
    );
    assert.strictEqual(saved.body.ok, true, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.upload.storageMb, 128);
    assert.equal(saved.body.settings.upload.whenFull, 'evict-oldest');
    assert.equal(saved.body.settings.storage.whenFull, 'evict-oldest');
    assert.equal(saved.body.settings.storage.limitBytes, 128 * 1024 * 1024);
    const clamped = await put('/api/v1/settings', { storageMb: 1, whenFull: 'nope' }, { token: tokens.admin.token });
    assert.equal(clamped.body.settings.upload.storageMb, 64);
    assert.equal(clamped.body.settings.upload.whenFull, 'evict-oldest');
  } finally {
    if (exhibitionId) {
      await del(`/api/v1/exhibitions/${exhibitionId}`, { token: tokens.exhibitor.token }).catch(() => undefined);
    }
    await put('/api/v1/settings', { storageMb: 1024, whenFull: 'reject' }, { token: tokens.admin.token }).catch(
      () => undefined,
    );
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  }
});

test('资料保存只改提交过的字段', async () => {
  const before = await get('/api/v1/profile', { token: tokens.user.token });
  const saved = await put('/api/v1/profile', { bio: '契约测试改的简介' }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  assert.strictEqual(saved.body.user.bio, '契约测试改的简介');
  assert.strictEqual(saved.body.user.nickname, before.body.nickname, '没提交的字段不应被改动');
  assert.strictEqual(saved.body.user.showRegistrations, before.body.showRegistrations);

  const long = await put('/api/v1/profile', { bio: '长'.repeat(5000) }, { token: tokens.user.token });
  assert.strictEqual(long.body.ok, false, '简介超长必须被服务端拦住');
});

test('改密码需要身份复核，成功后旧刷新令牌失效', async () => {
  const session = await login('user');
  const profile = await get('/api/v1/profile', { token: session.token });
  const email = String(profile.body.email);
  const noProof = await post(
    '/api/v1/profile/password',
    {
      currentPassword: 'password',
      newPassword: 'newpassword',
      confirmPassword: 'newpassword',
    },
    { token: session.token },
  );
  assert.strictEqual(noProof.body.ok, false, '仅有当前密码不能修改密码');

  const mismatch = await post(
    '/api/v1/profile/password',
    {
      newPassword: 'newpassword',
      confirmPassword: 'other',
      stepUpToken: 'not-consumed-until-input-is-valid',
    },
    { token: session.token },
  );
  assert.strictEqual(mismatch.body.ok, false);

  const proof = await identityTicket(session.token, email, 'password');
  const changed = await post(
    '/api/v1/profile/password',
    {
      newPassword: 'newpassword',
      confirmPassword: 'newpassword',
      stepUpToken: proof,
    },
    { token: session.token },
  );
  assert.strictEqual(changed.body.ok, true, JSON.stringify(changed.body));

  const reused = await post('/api/v1/auth/refresh', { refreshToken: session.refreshToken });
  assert.strictEqual(reused.status, 401, '改密码后旧刷新令牌必须失效');

  const relogin = await login('user', 'newpassword');
  assert.ok(relogin.token);
  const restoreProof = await identityTicket(relogin.token, email, 'password');
  const restored = await post(
    '/api/v1/profile/password',
    {
      newPassword: 'password',
      confirmPassword: 'password',
      stepUpToken: restoreProof,
    },
    { token: relogin.token },
  );
  assert.strictEqual(restored.body.ok, true, '还原密码失败，后续用例会受影响');
  tokens.user = await login('user');
});

test('通知偏好可读可写', async () => {
  const current = await get('/api/v1/profile/notifications', { token: tokens.user.token });
  assert.strictEqual(typeof current.body.exhibitionReminder, 'boolean');
  assert.strictEqual(typeof current.body.registrationUpdates, 'boolean');

  const saved = await put('/api/v1/profile/notifications', { exhibitionReminder: false }, { token: tokens.user.token });
  assert.strictEqual(saved.body.ok, true);
  const reread = await get('/api/v1/profile/notifications', { token: tokens.user.token });
  assert.strictEqual(reread.body.exhibitionReminder, false);
  assert.strictEqual(reread.body.registrationUpdates, current.body.registrationUpdates, '未提交的字段不应被改动');
  await put('/api/v1/profile/notifications', { exhibitionReminder: true }, { token: tokens.user.token });
});
