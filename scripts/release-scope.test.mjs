import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forceReleaseScope, isMergeCommit, masterCiGate, releaseScope } from './release-scope.mjs';

function flags(paths) {
  return releaseScope(paths);
}

test('只改服务端运行时代码时部署服务，不发客户端', () => {
  assert.deepEqual(flags(['server/src/routes/exhibitions-hono.ts']), {
    apk: false,
    server: true,
    app: false,
    join: false,
  });
});

test('只改原生外壳时发 APK，不部署服务', () => {
  assert.deepEqual(flags(['app/src/main/java/com/example/calmobile/WebShellActivity.java']), {
    apk: true,
    server: false,
    app: false,
    join: false,
  });
  assert.deepEqual(flags(['gradle/wrapper/gradle-wrapper.properties']), {
    apk: true,
    server: false,
    app: false,
    join: false,
  });
});

test('只改 App 页面时同步应用页面，不发 APK、不重启', () => {
  assert.deepEqual(flags(['web/src/pages/HomePage.vue']), {
    apk: false,
    server: false,
    app: true,
    join: false,
  });
  assert.deepEqual(flags(['web/release-manifest.mjs']), {
    apk: false,
    server: false,
    app: true,
    join: false,
  });
});

test('报名站和 App 共用的源两份一起同步', () => {
  assert.deepEqual(flags(['web/src/i18n/zh.json']), {
    apk: false,
    server: false,
    app: true,
    join: true,
  });
  assert.deepEqual(flags(['web/src/pages/LoginPage.vue']), {
    apk: false,
    server: false,
    app: true,
    join: true,
  });
});

test('报名站专有文件只同步报名站', () => {
  assert.deepEqual(flags(['web/src/join/router.ts', 'web/join.html']), {
    apk: false,
    server: false,
    app: false,
    join: true,
  });
});

test('答卷文稿同时重启服务并更新两份页面', () => {
  assert.deepEqual(flags(['server/src/domain/answer-document.ts']), {
    apk: false,
    server: true,
    app: true,
    join: true,
  });
});

test('构建目标脚本发外壳并更新应用页面', () => {
  assert.deepEqual(flags(['scripts/client-target.mjs']), {
    apk: true,
    server: false,
    app: true,
    join: false,
  });
});

test('文档、测试和开发脚本不触发 CD', () => {
  assert.deepEqual(
    flags([
      'AGENTS.md',
      'docs/operations.md',
      'server/src/routes/exhibitions-hono.test.ts',
      'server/src/test/registrations.test.ts',
      'server/src/dev/adb-reverse.ts',
      'server/scripts/dev.ts',
      'app/src/test/java/com/example/calmobile/AssetGuardTest.java',
      'web/src/pages/profile-page.test.ts',
      'web/api-endpoints.mjs',
      '.github/workflows/ci.yml',
    ]),
    { apk: false, server: false, app: false, join: false },
  );
});

test('提交对象里有两个 parent 才是合并提交', () => {
  assert.equal(
    isMergeCommit('tree abc\nparent 111\nparent 222\n\nMerge pull request\nparent 在正文里不算'),
    true,
  );
  assert.equal(isMergeCommit('tree abc\nparent 111\n\n普通提交'), false);
  assert.equal(isMergeCommit('tree abc\n\n没有父提交'), false);
});

test('强制发布按开关来，发 APK 带上应用页面，重启带上报名站', () => {
  assert.deepEqual(forceReleaseScope({ apk: 'true', server: 'false', app: 'false', join: 'false' }), {
    apk: true,
    server: false,
    app: true,
    join: false,
  });
  assert.deepEqual(forceReleaseScope({ apk: 'false', server: 'true', app: 'false', join: 'false' }), {
    apk: false,
    server: true,
    app: false,
    join: true,
  });
  assert.deepEqual(forceReleaseScope({ apk: false, server: false, app: true, join: false }), {
    apk: false,
    server: false,
    app: true,
    join: false,
  });
});

test('强制发布没有选择或开关写错时拒绝', () => {
  assert.throws(() => forceReleaseScope({ apk: 'false', server: 'false', app: 'false', join: 'false' }), /至少要选一项/);
  assert.throws(() => forceReleaseScope({ apk: 'yes', server: 'false', app: 'false', join: 'false' }), /必须是 true 或 false/);
  assert.throws(() => forceReleaseScope({ server: 'true' }), /缺少 apk/);
});

test('强制发布只认 master 上已经成功的推送检查', () => {
  assert.deepEqual(
    masterCiGate([{ event: 'push', headBranch: 'master', status: 'completed', conclusion: 'success' }]),
    { ok: true, reason: '' },
  );
  assert.equal(
    masterCiGate([{ event: 'push', headBranch: 'master', status: 'in_progress', conclusion: '' }]).ok,
    false,
  );
  assert.match(
    masterCiGate([{ event: 'push', headBranch: 'master', status: 'in_progress', conclusion: '' }]).reason,
    /还在跑/,
  );
  assert.match(
    masterCiGate([{ event: 'pull_request', headBranch: 'master', status: 'completed', conclusion: 'success' }]).reason,
    /还没有成功的 CI/,
  );
  assert.match(
    masterCiGate([{ event: 'push', headBranch: 'master', status: 'completed', conclusion: 'failure' }]).reason,
    /还没有成功的 CI/,
  );
});

test('同一次推送里各算各的', () => {
  assert.deepEqual(flags(['server/src/index.ts', 'app/build.gradle', 'README.md']), {
    apk: true,
    server: true,
    app: false,
    join: false,
  });
});
