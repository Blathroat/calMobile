import assert from 'node:assert/strict';
import { planEviction, storedMediaKey, storedMediaUrls, stripStoredMedia } from './media-quota.js';

test('只认出本服务的媒体地址', () => {
  const text = [
    '![图](/media/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg)',
    '<video controls src="https://cdn.example.com/media/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4"></video>',
    '![外链](https://example.com/a.jpg)',
    'https://appassets.androidplatform.net/media/local.jpg',
  ].join('\n');
  assert.deepEqual(storedMediaUrls(text), [
    '/media/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    '/media/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4',
  ]);
  assert.equal(storedMediaKey('/media/avatars/cccccccccccccccccccccccccccccccc.png'), 'avatars/cccccccccccccccccccccccccccccccc.png');
  assert.equal(storedMediaKey('https://appassets.androidplatform.net/media/local.jpg'), null);
});

test('从正文里摘掉打不开的图片和视频', () => {
  const text = [
    '开头',
    '![展会图片](/media/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg)',
    '<video controls src="/media/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4"></video>',
    '结尾',
  ].join('\n');
  const next = stripStoredMedia(text, [
    'files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    'files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp4',
  ]);
  assert.equal(next.includes('开头'), true);
  assert.equal(next.includes('结尾'), true);
  assert.equal(next.includes('/media/files/'), false);
});

test('腾位置时先删无引用文件；拒绝策略不会动仍被引用的文件', () => {
  const files = [
    { id: 'files/old-orphan', bytes: 40, mtimeMs: 1, orphan: true },
    { id: 'files/live', bytes: 50, mtimeMs: 2, orphan: false },
    { id: 'files/fresh-orphan', bytes: 30, mtimeMs: 3, orphan: true },
  ];
  const rejected = planEviction({ used: 120, incoming: 80, limit: 100, whenFull: 'reject', files });
  assert.deepEqual(rejected, { ok: false, evict: ['files/old-orphan', 'files/fresh-orphan'] });

  const evicted = planEviction({ used: 120, incoming: 80, limit: 100, whenFull: 'evict-oldest', files });
  assert.deepEqual(evicted, { ok: true, evict: ['files/old-orphan', 'files/fresh-orphan', 'files/live'] });

  const fits = planEviction({ used: 10, incoming: 20, limit: 100, whenFull: 'reject', files });
  assert.deepEqual(fits, { ok: true, evict: [] });
});
