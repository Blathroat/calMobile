/**
 * 版本 / 下载源解析的单元测试（不连数据库、不真的访问 GitHub）。
 *
 * 钉住三件事：字段怎么取、结果怎么缓存、失败怎么降级成空地址。
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, vi } from 'vitest';
import { clearReleaseCache, parseLatestRelease, resolveRelease } from './release.js';

const SETTINGS = { download: { source: 'url' as const, url: 'https://example.com/app.apk', repo: '' } };

function githubSettings(repo: string) {
  return { download: { source: 'github' as const, url: '', repo } };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const RELEASE_PAYLOAD = {
  tag_name: 'v1.4.0',
  body: '修复了下拉刷新手势\n- 新增通行密钥',
  published_at: '2026-10-01T08:00:00Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.4.0',
  assets: [
    { name: 'notes.txt', browser_download_url: 'https://github.com/owner/repo/releases/download/v1.4.0/notes.txt' },
    {
      name: 'calMobile-1.4.0.apk',
      browser_download_url: 'https://github.com/owner/repo/releases/download/v1.4.0/app.apk',
    },
  ],
};

beforeEach(() => {
  clearReleaseCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('直链源原样下发地址，版本与更新日志为空', async () => {
  const release = await resolveRelease(SETTINGS);
  assert.deepEqual(release, {
    source: 'url',
    version: '',
    notes: '',
    url: 'https://example.com/app.apk',
    publishedAt: '',
  });
  // 没配地址（或没有设置段）时给空串，页面据此隐藏入口
  assert.equal((await resolveRelease({ download: { source: 'url', url: '', repo: '' } })).url, '');
  assert.equal((await resolveRelease(null)).url, '');
});

test('GitHub 源取第一个 .apk 资产、去掉 tag 的 v 前缀，并带正确的请求头', async () => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), headers: (init.headers || {}) as Record<string, string> });
    return jsonResponse(RELEASE_PAYLOAD);
  });
  const release = await resolveRelease(githubSettings('owner/repo'), {});
  assert.deepEqual(release, {
    source: 'github',
    version: '1.4.0',
    notes: RELEASE_PAYLOAD.body,
    url: 'https://github.com/owner/repo/releases/download/v1.4.0/app.apk',
    publishedAt: '2026-10-01T08:00:00Z',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, 'https://api.github.com/repos/owner/repo/releases/latest');
  assert.equal(requests[0]!.headers.Accept, 'application/vnd.github+json');
  assert.equal(requests[0]!.headers['User-Agent'], 'calMobile-server');
  assert.equal(requests[0]!.headers.Authorization, undefined, '没有 GITHUB_TOKEN 时不带 Authorization');
});

test('有 GITHUB_TOKEN 时带 Bearer 授权头', async () => {
  let authorization = '';
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    authorization = String((init.headers as Record<string, string>).Authorization || '');
    return jsonResponse(RELEASE_PAYLOAD);
  });
  await resolveRelease(githubSettings('owner/repo'), { GITHUB_TOKEN: 'ghp-test-token' });
  assert.equal(authorization, 'Bearer ghp-test-token');
});

test('没有 .apk 资产时退回 Release 页面地址；字段缺失不报错', async () => {
  vi.stubGlobal('fetch', async () =>
    jsonResponse({
      tag_name: '2.0.0',
      body: null,
      published_at: null,
      html_url: 'https://github.com/o/r/releases/tag/2.0.0',
      assets: [{ name: 'source.zip' }],
    }),
  );
  const release = await resolveRelease(githubSettings('o/r'), {});
  assert.equal(release.version, '2.0.0');
  assert.equal(release.notes, '');
  assert.equal(release.publishedAt, '');
  assert.equal(release.url, 'https://github.com/o/r/releases/tag/2.0.0');
});

test('parseLatestRelease 只看 .apk 资产（大小写不敏感）', () => {
  const release = parseLatestRelease({
    ...RELEASE_PAYLOAD,
    assets: [{ name: 'APP.APK', browser_download_url: 'https://example.com/APP.APK' }],
  });
  assert.equal(release.url, 'https://example.com/APP.APK');
});

test('成功结果缓存 5 分钟：期间不再请求 GitHub，过期后重新取', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls += 1;
    return jsonResponse(RELEASE_PAYLOAD);
  });
  await resolveRelease(githubSettings('owner/repo'), {});
  await resolveRelease(githubSettings('owner/repo'), {});
  assert.equal(calls, 1, '5 分钟内命中缓存');
  vi.setSystemTime(new Date('2026-10-01T00:05:01Z'));
  await resolveRelease(githubSettings('owner/repo'), {});
  assert.equal(calls, 2, '缓存过期后重新请求');
});

test('失败降级成空地址并缓存 60 秒，不抛 5xx', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls += 1;
    throw new Error('network down');
  });
  const failed = await resolveRelease(githubSettings('owner/repo'), {});
  assert.deepEqual(failed, { source: 'github', version: '', notes: '', url: '', publishedAt: '' });
  await resolveRelease(githubSettings('owner/repo'), {});
  assert.equal(calls, 1, '失败结果 60 秒内不再打接口');
  vi.setSystemTime(new Date('2026-10-01T00:01:01Z'));
  await resolveRelease(githubSettings('owner/repo'), {});
  assert.equal(calls, 2, '60 秒后重试');
});

test('GitHub 返回非 2xx 时同样降级成空地址', async () => {
  vi.stubGlobal('fetch', async () => jsonResponse({ message: 'Not Found' }, 404));
  const release = await resolveRelease(githubSettings('owner/repo'), {});
  assert.equal(release.url, '');
  assert.equal(release.source, 'github');
});

test('仓库为空时直接给空地址，不请求接口', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls += 1;
    return jsonResponse(RELEASE_PAYLOAD);
  });
  const release = await resolveRelease(githubSettings(''), {});
  assert.equal(release.url, '');
  assert.equal(calls, 0);
});
