import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { resolveUploadConfig } from '../config/upload.js';
import {
  avatarFileFromStoredUrl,
  deleteStoredAvatar,
  formatAllowed,
  inspectAvatar,
  MAX_AVATAR_EDGE,
  readAvatarFile,
  readCappedBytes,
  resolveAvatarFile,
  storedAvatarUrl,
  writeAvatarFile,
} from './avatar-store.js';

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.from(row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function webp(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.concat([Buffer.from('VP8X'), Buffer.alloc(4), data]);
  chunk.writeUInt32LE(10, 4);
  const file = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), chunk]);
  file.writeUInt32LE(4 + chunk.length, 4);
  return file;
}

test('识别 jpeg、png、webp，并拒绝超大或无法识别的字节', () => {
  assert.deepEqual(inspectAvatar(jpeg(8, 8)), { ok: true, image: { extension: 'jpg', width: 8, height: 8 } });
  assert.deepEqual(inspectAvatar(png(2, 3)), { ok: true, image: { extension: 'png', width: 2, height: 3 } });
  assert.deepEqual(inspectAvatar(webp(4, 5)), { ok: true, image: { extension: 'webp', width: 4, height: 5 } });
  const huge = inspectAvatar(jpeg(MAX_AVATAR_EDGE + 1, 8));
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.reason, 'too-large');
  assert.deepEqual(inspectAvatar(Buffer.from('not an image')), { ok: false, reason: 'unknown' });
});

test('jpg 与 jpeg 等价，其它后缀按列表精确匹配', () => {
  assert.equal(formatAllowed('jpg', ['jpeg']), true);
  assert.equal(formatAllowed('jpg', ['png']), false);
  assert.equal(formatAllowed('png', ['png', 'webp']), true);
});

test('声明超限时不读流；读到上限后停', async () => {
  // 流一创建就会自己 pull 去填队列，所以不能用 pull 判断「有没有读」。
  // 声明长度已经超限时，读取函数不应再取 reader。
  let gotReader = false;
  // 声明长度已经超限时只会看 getReader 有没有被调用，不必真的建一条流。
  const stream = {
    getReader() {
      gotReader = true;
      throw new Error('不应读取');
    },
  } as unknown as ReadableStream<Uint8Array>;
  const skipped = await readCappedBytes(stream, 4, 5);
  assert.equal(skipped.ok, false);
  assert.equal(gotReader, false);

  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const over = await readCappedBytes(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }), 4);
  assert.equal(over.ok, false);
});

test('只删除本服务写出的头像，路径不能逃出目录', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'calmobile-avatar-'));
  const config = resolveUploadConfig({ UPLOAD_DIR: directory, MEDIA_BASE_URL: 'https://cdn.example.com' });
  try {
    const fileName = await writeAvatarFile(jpeg(8, 8), 'jpg', config);
    const url = storedAvatarUrl(fileName, config);
    assert.equal(url, `https://cdn.example.com/media/avatars/${fileName}`);
    assert.equal(avatarFileFromStoredUrl(url), fileName);
    assert.equal(avatarFileFromStoredUrl('https://appassets.androidplatform.net/media/local.jpg'), null);
    assert.equal(resolveAvatarFile(`../${fileName}`, config), null);
    assert.ok(await readAvatarFile(fileName, config));
    await deleteStoredAvatar(url, config);
    assert.equal(await readAvatarFile(fileName, config), null);
    await deleteStoredAvatar('https://appassets.androidplatform.net/media/local.jpg', config);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
