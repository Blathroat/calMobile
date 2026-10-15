import assert from 'node:assert/strict';
import { inspectContent, sniffVideo } from './content-media.js';

test('视频只认 webm 头和 ftyp', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  assert.equal(sniffVideo(webm), 'webm');
  const mp4 = Buffer.alloc(12);
  mp4.write('ftyp', 4, 'ascii');
  assert.equal(sniffVideo(mp4), 'mp4');
  assert.equal(sniffVideo(Buffer.from([1, 2, 3, 4])), null);
});

test('视频后缀必须在服务器允许的列表里', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const rejected = inspectContent(webm, 'video', ['mp4']);
  assert.equal(rejected.ok, false);
  const accepted = inspectContent(webm, 'video', ['webm']);
  assert.deepEqual(accepted, { ok: true, extension: 'webm' });
});
