/**
 * 管理员代改头像 契约测试。
 *
 * - 非管理员（未登录 / 普通用户 / 展商）调用 `POST /users/:id/avatar` 被 401 / 403 拦住；
 * - 管理员上传后目标账号的 `avatar` 变化，公开页与用户列表跟着换图，管理员自己的会话不被改动；
 * - 旧头像文件在新头像写库后被删掉；
 * - 目标账号不存在是 404；目标账号受限 / 封禁不影响管理员代改；
 * - 校验口径与本人上传完全一致（同一个格式白名单错误码）。
 *
 * 共享设施见 `./contract-harness.ts`；每个文件各自起停一套契约环境。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { get, put, serverPort, startContract, stopContract, tokens, type HttpResponse } from './contract-harness.js';

beforeAll(startContract);
afterAll(stopContract);

/** 8×8 的最小 JPEG：带 SOI、SOF0 和 EOI，上传校验认得出。 */
function minimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

/** 直接发原始字节：头像上传不认 JSON 包装，共享的 `post()` 会把 Buffer 编码坏。 */
function requestBytes(
  method: string,
  requestPath: string,
  payload: Buffer,
  { token }: { token?: string } = {},
): Promise<HttpResponse & { raw: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: serverPort(),
        path: requestPath,
        method,
        headers: {
          'Content-Type': 'image/jpeg',
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
          resolve({ status: res.statusCode ?? 0, body, raw });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** 头像文件在临时上传目录里的实际路径：`/media/avatars/<文件名>` → `<UPLOAD_DIR>/avatars/<文件名>`。 */
function avatarPath(directory: string, url: string): string {
  return path.join(directory, 'avatars', url.slice(url.lastIndexOf('/') + 1));
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

test('非管理员不能给别的账号换头像', async () => {
  const targetId = String(tokens.user.user.id);
  const jpeg = minimalJpeg();
  const anonymous = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, jpeg);
  assert.strictEqual(anonymous.status, 401);

  const asUser = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, jpeg, {
    token: tokens.user.token,
  });
  assert.strictEqual(asUser.status, 403);

  const asExhibitor = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, jpeg, {
    token: tokens.exhibitor.token,
  });
  assert.strictEqual(asExhibitor.status, 403);
});

test('管理员给目标账号换头像：目标换图、旧文件清理、管理员会话不变', async () => {
  const previousDir = process.env.UPLOAD_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-admin-avatar-'));
  process.env.UPLOAD_DIR = directory;
  const jpeg = minimalJpeg();
  const targetId = String(tokens.user.user.id);
  const adminAvatarBefore = String((await get('/api/v1/profile', { token: tokens.admin.token })).body.avatar || '');
  const targetAvatarBefore = String((await get('/api/v1/profile', { token: tokens.user.token })).body.avatar || '');
  let firstUrl = '';
  let secondUrl = '';
  try {
    const uploaded = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, jpeg, {
      token: tokens.admin.token,
    });
    assert.strictEqual(uploaded.status, 200, JSON.stringify(uploaded.body));
    assert.strictEqual(uploaded.body.ok, true, JSON.stringify(uploaded.body));
    firstUrl = String(uploaded.body.url);
    assert.match(firstUrl, /^\/media\/avatars\/[a-f0-9]{32}\.jpg$/);
    // 返回的是目标账号的 user payload，不是管理员自己的。
    assert.strictEqual(uploaded.body.user.id, targetId);
    assert.strictEqual(uploaded.body.user.avatar, firstUrl);
    assert.ok(await exists(avatarPath(directory, firstUrl)), '新头像文件应已落盘');
    if (targetAvatarBefore) assert.notStrictEqual(firstUrl, targetAvatarBefore);

    // 目标账号与公开页都能读回新地址。
    const targetProfile = await get('/api/v1/profile', { token: tokens.user.token });
    assert.strictEqual(targetProfile.body.avatar, firstUrl);
    const publicProfile = await get(`/api/v1/users/public?userId=${targetId}`, { token: tokens.admin.token });
    assert.strictEqual(publicProfile.body.avatar, firstUrl);
    // 管理员自己的头像一点没动。
    const adminProfile = await get('/api/v1/profile', { token: tokens.admin.token });
    assert.strictEqual(adminProfile.body.avatar, adminAvatarBefore, '不能把目标头像写进管理员会话');

    // 再换一次：新地址生效，上一张文件被删掉。
    const replaced = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, jpeg, {
      token: tokens.admin.token,
    });
    assert.strictEqual(replaced.body.ok, true, JSON.stringify(replaced.body));
    secondUrl = String(replaced.body.url);
    assert.notStrictEqual(secondUrl, firstUrl);
    assert.strictEqual(await exists(avatarPath(directory, secondUrl)), true);
    assert.strictEqual(await exists(avatarPath(directory, firstUrl)), false, '旧头像文件应被清理');
    const gone = await requestBytes('GET', firstUrl, Buffer.alloc(0));
    assert.strictEqual(gone.status, 404, '旧头像地址应已打不开');
  } finally {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
    // 换回原来的头像，避免影响同文件后面的用例（头像地址已不存在，直接写回即可）。
    if (targetAvatarBefore)
      await put(`/api/v1/users/${targetId}/profile`, { avatar: '' }, { token: tokens.admin.token });
  }
});

test('目标账号不存在时返回 404', async () => {
  const missing = await requestBytes('POST', '/api/v1/users/not-exist-user/avatar', minimalJpeg(), {
    token: tokens.admin.token,
  });
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.body.errorCode, 'users.notFound');
});

test('目标账号受限或封禁不影响管理员代改头像', async () => {
  const targetId = String(tokens.user.user.id);
  const previousDir = process.env.UPLOAD_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-admin-avatar-'));
  process.env.UPLOAD_DIR = directory;
  try {
    for (const status of ['limited', 'banned'] as const) {
      const changed = await put(`/api/v1/users/${targetId}/status`, { status }, { token: tokens.admin.token });
      assert.strictEqual(changed.body.ok, true, JSON.stringify(changed.body));
      const uploaded = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, minimalJpeg(), {
        token: tokens.admin.token,
      });
      assert.strictEqual(uploaded.status, 200, `${status} 目标上传应成功：${JSON.stringify(uploaded.body)}`);
      assert.strictEqual(uploaded.body.ok, true, JSON.stringify(uploaded.body));
      assert.strictEqual(uploaded.body.user.id, targetId);
    }
  } finally {
    await put(`/api/v1/users/${targetId}/status`, { status: 'active' }, { token: tokens.admin.token });
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  }
});

test('代改头像的校验口径与本人上传一致', async () => {
  const previousDir = process.env.UPLOAD_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-admin-avatar-'));
  process.env.UPLOAD_DIR = directory;
  const targetId = String(tokens.user.user.id);
  try {
    const narrowed = await put('/api/v1/settings', { avatarFormats: 'png' }, { token: tokens.admin.token });
    assert.strictEqual(narrowed.body.ok, true, JSON.stringify(narrowed.body));
    const rejected = await requestBytes('POST', `/api/v1/users/${targetId}/avatar`, minimalJpeg(), {
      token: tokens.admin.token,
    });
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.body.ok, false);
    assert.match(String(rejected.body.error), /不允许上传 \.jpg/);
    assert.strictEqual(rejected.body.errorCode, 'profile.avatarFormatRejected');
    assert.deepEqual(rejected.body.errorParams, { ext: 'jpg', formats: 'png' });
  } finally {
    await put('/api/v1/settings', { avatarFormats: 'jpg,jpeg,png,webp' }, { token: tokens.admin.token });
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  }
});
