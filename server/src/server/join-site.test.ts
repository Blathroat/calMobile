import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canonicalRedirect,
  isJoinPagePath,
  joinSiteMissingMessage,
  joinSiteReady,
  lookupJoinFile,
  requestHost,
} from './join-site.js';

test('报名页和接口路径分开', () => {
  assert.equal(isJoinPagePath('/e/exh-1'), true);
  assert.equal(isJoinPagePath('/'), true);
  assert.equal(isJoinPagePath('/api/v1/ping'), false);
  assert.equal(isJoinPagePath('/media/avatars/a.jpg'), false);
  assert.equal(isJoinPagePath('/ping'), false);
  assert.equal(isJoinPagePath('/health'), false);
  assert.equal(isJoinPagePath('/status'), false);
});

test('没配域名不跳转，Host 不一致才跳到 PUBLIC_BASE_URL', () => {
  assert.equal(
    canonicalRedirect({
      requestHost: 'localhost:3000',
      publicBaseUrl: '',
      pathAndQuery: '/e/exh-1',
    }),
    null,
  );
  assert.equal(
    canonicalRedirect({
      requestHost: 'app.example.com',
      publicBaseUrl: 'https://app.example.com',
      pathAndQuery: '/e/exh-1',
    }),
    null,
  );
  assert.equal(
    canonicalRedirect({
      requestHost: 'localhost:3000',
      publicBaseUrl: 'https://app.example.com/',
      pathAndQuery: '/e/exh-1?from=share',
    }),
    'https://app.example.com/e/exh-1?from=share',
  );
});

test('只有打开 TRUST_PROXY 才采信 X-Forwarded-Host', () => {
  assert.equal(
    requestHost({ host: '127.0.0.1:3000', forwardedHost: 'app.example.com', trustProxy: false }),
    '127.0.0.1:3000',
  );
  assert.equal(
    requestHost({ host: '127.0.0.1:3000', forwardedHost: 'app.example.com, proxy.internal', trustProxy: 1 }),
    'app.example.com',
  );
});

test('报名站文件落在目录内，缺的脚本不回退成页面', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'calmobile-join-'));
  try {
    writeFileSync(path.join(root, 'join.html'), '<!doctype html><title>报名</title>');
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
    assert.equal(joinSiteReady(root), true);
    const page = lookupJoinFile(root, '/e/exh-1');
    assert.equal(page.kind, 'file');
    if (page.kind === 'file') assert.match(page.file.body.toString(), /报名/);
    const script = lookupJoinFile(root, '/assets/app.js');
    assert.equal(script.kind, 'file');
    assert.equal(lookupJoinFile(root, '/assets/missing.js').kind, 'missing');
    assert.equal(lookupJoinFile(root, '/../secret').kind, 'missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('产物缺失时的说明指向构建命令', () => {
  assert.match(joinSiteMissingMessage('/tmp/missing'), /pnpm --dir server build/);
  assert.equal(joinSiteReady(path.join(tmpdir(), 'calmobile-join-absent')), false);
});
