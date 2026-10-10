import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveUploadConfig } from './upload.js';

test('上传目录、对外前缀和硬顶都按环境解析', () => {
  const config = resolveUploadConfig({
    UPLOAD_DIR: 'data/custom',
    MEDIA_BASE_URL: 'https://cdn.example.com/',
    UPLOAD_MAX_MB: '8',
  });
  assert.equal(config.dir, path.resolve('data/custom'));
  assert.equal(config.mediaBaseUrl, 'https://cdn.example.com');
  assert.equal(config.maxMb, 8);
});

test('非法前缀当没配，硬顶夹在 1..20，缺省用内置目录', () => {
  const config = resolveUploadConfig({ MEDIA_BASE_URL: 'not a url', UPLOAD_MAX_MB: '0' });
  assert.equal(config.mediaBaseUrl, '');
  assert.equal(config.maxMb, 20);
  assert.equal(path.basename(config.dir), 'uploads');
  assert.equal(resolveUploadConfig({ UPLOAD_MAX_MB: '99' }).maxMb, 20);
});
