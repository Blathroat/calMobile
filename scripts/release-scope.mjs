/**
 * 判断一次推送要不要发 APK、重启服务、同步应用页面或报名站。
 *
 * CI 把 `git diff --name-only` 的结果交过来。这里只看路径，不读文件内容。
 * 静态页面宁可多同步一次，也不要为此发 APK 或重启服务。
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 报名站路由没有引用、只进 App 包的页面。新页面没写进来时两份一起同步。 */
const APP_ONLY_PAGES = new Set([
  'web/src/pages/AdminExhibitionsPage.vue',
  'web/src/pages/AdminExhibitionsSection.vue',
  'web/src/pages/AdminMeetingsPage.vue',
  'web/src/pages/AdminPage.vue',
  'web/src/pages/AdminSettingsSection.vue',
  'web/src/pages/AdminUsersSection.vue',
  'web/src/pages/CheckinPage.vue',
  'web/src/pages/DetailPage.vue',
  'web/src/pages/ExhibitionFormPage.vue',
  'web/src/pages/ExhibitorPage.vue',
  'web/src/pages/HomePage.vue',
  'web/src/pages/MeetingSettingsPage.vue',
  'web/src/pages/ProfilePage.vue',
  'web/src/pages/ReviewPage.vue',
  'web/src/pages/RichEditorPage.vue',
  'web/src/pages/SearchPage.vue',
  'web/src/pages/SecurityDevicesPage.vue',
  'web/src/pages/SecurityPage.vue',
  'web/src/pages/UserPublicPage.vue',
  'web/src/pages/UserSettingsPage.vue',
]);

const APK_ROOTS = ['app/', 'gradle/'];
const APK_FILES = new Set([
  'build.gradle',
  'settings.gradle',
  'gradle.properties',
  'gradlew',
  'gradlew.bat',
  'scripts/client-target.mjs',
]);

/**
 * @param {string[]} paths
 * @returns {{ apk: boolean, server: boolean, app: boolean, join: boolean }}
 */
export function releaseScope(paths) {
  const scope = { apk: false, server: false, app: false, join: false };
  for (const raw of paths) {
    const file = String(raw)
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .trim();
    if (!file || file.includes('\0')) continue;
    const hit = classify(file);
    scope.apk ||= hit.apk;
    scope.server ||= hit.server;
    scope.app ||= hit.app;
    scope.join ||= hit.join;
  }
  return scope;
}

/**
 * @param {string} file
 * @returns {{ apk: boolean, server: boolean, app: boolean, join: boolean }}
 */
function classify(file) {
  const none = { apk: false, server: false, app: false, join: false };
  if (ignored(file)) return none;
  const hit = { ...none };
  if (isApk(file)) hit.apk = true;
  if (isServer(file)) hit.server = true;
  if (file === 'server/src/domain/answer-document.ts') {
    hit.app = true;
    hit.join = true;
  }
  if (file === 'scripts/client-target.mjs') hit.app = true;
  if (isJoinOnly(file)) hit.join = true;
  if (isAppOnly(file)) hit.app = true;
  if (isSharedWeb(file)) {
    hit.app = true;
    hit.join = true;
  }
  return hit;
}

/** @param {string} file */
function ignored(file) {
  if (file.endsWith('.md')) return true;
  if (file.startsWith('docs/') || file.startsWith('.github/')) return true;
  if (file.endsWith('.test.ts') || file.endsWith('.test.js') || file.endsWith('.test.mjs')) return true;
  if (file.includes('/test/') || file.startsWith('server/src/dev/') || file.startsWith('app/src/test/')) return true;
  if (file === 'server/scripts/dev.ts' || file === 'web/api-endpoints.mjs') return true;
  if (file === 'web/src/env.d.ts' || file === 'web/tsconfig.json' || file === 'web/vitest.config.ts') return true;
  if (file === 'server/vitest.config.mjs' || file === 'docker-compose.yml') return true;
  return false;
}

/** @param {string} file */
function isApk(file) {
  if (APK_FILES.has(file)) return true;
  if (!APK_ROOTS.some((root) => file.startsWith(root))) return false;
  return file.startsWith('app/src/main/') || file === 'app/build.gradle' || file.startsWith('gradle/');
}

/** @param {string} file */
function isServer(file) {
  if (
    file.startsWith('deploy/') ||
    file === 'scripts/remote-release.sh' ||
    file === 'scripts/sync-production-env.mjs'
  ) {
    return true;
  }
  if (file === 'server/package.json' || file === 'server/pnpm-lock.yaml' || file === 'server/pnpm-workspace.yaml') {
    return true;
  }
  if (file === 'server/tsconfig.json' || file === 'server/scripts/build-status-page.ts') return true;
  if (file.startsWith('server/status-page/')) return true;
  if (!file.startsWith('server/src/')) return false;
  return true;
}

/** @param {string} file */
function isJoinOnly(file) {
  return (
    file === 'web/join.html' ||
    file === 'web/vite.join.config.ts' ||
    file.startsWith('web/src/join/') ||
    file === 'server/scripts/build-join.ts'
  );
}

/** @param {string} file */
function isAppOnly(file) {
  return (
    file === 'web/index.html' ||
    file === 'web/vite.config.ts' ||
    file === 'web/src/main.ts' ||
    file === 'web/release-manifest.mjs' ||
    APP_ONLY_PAGES.has(file)
  );
}

/** 报名站和 App 都会打进去的源。页面文件不在「只进 App」清单里时也走这里。 */
function isSharedWeb(file) {
  if (file === 'web/package.json' || file === 'web/pnpm-lock.yaml' || file.startsWith('web/public/')) return true;
  if (!file.startsWith('web/src/') || file.startsWith('web/src/join/')) return false;
  if (file === 'web/src/main.ts' || file === 'web/src/env.d.ts' || APP_ONLY_PAGES.has(file)) return false;
  return true;
}

function readPaths(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('用法：node scripts/release-scope.mjs <变更文件清单>\n');
    process.exit(2);
  }
  const scope = releaseScope(readPaths(readFileSync(file, 'utf8')));
  process.stdout.write(`apk=${scope.apk}\nserver=${scope.server}\napp=${scope.app}\njoin=${scope.join}\n`);
}
