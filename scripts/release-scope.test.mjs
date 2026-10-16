import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseScope } from './release-scope.mjs';

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

test('同一次推送里各算各的', () => {
  assert.deepEqual(flags(['server/src/index.ts', 'app/build.gradle', 'README.md']), {
    apk: true,
    server: true,
    app: false,
    join: false,
  });
});
