/**
 * 判断一次推送要不要发 APK、重启服务、同步应用页面或报名站。
 *
 * CI 把 `git diff --name-only` 的结果交过来。这里只看路径，不读文件内容。
 * 静态页面宁可多同步一次，也不要为此发 APK 或重启服务。
 *
 * 手动强制发布不看路径。发 APK 时总会同步应用页面，避免新包装上之后热更新回旧页面。
 * 重启服务时总会同步报名站，和部署脚本的行为一致。
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

const FORCE_KEYS = ['apk', 'server', 'app', 'join'];

/**
 * 浅克隆里 `git rev-list --parents` 看不到父提交。父提交写在提交对象的头里。
 *
 * @param {string} commitText `git cat-file -p` 的输出。
 */
export function isMergeCommit(commitText) {
  const header = String(commitText).split(/\r?\n\r?\n/, 1)[0] ?? '';
  const parents = header.split(/\r?\n/).filter((line) => line.startsWith('parent '));
  return parents.length >= 2;
}

/**
 * @param {Record<string, unknown>} flags
 * @returns {{ apk: boolean, server: boolean, app: boolean, join: boolean }}
 */
export function forceReleaseScope(flags) {
  /** @type {{ apk: boolean, server: boolean, app: boolean, join: boolean }} */
  const scope = { apk: false, server: false, app: false, join: false };
  for (const key of FORCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new Error(`强制发布缺少 ${key}`);
    }
    const value = flags[key];
    if (value !== 'true' && value !== 'false' && value !== true && value !== false) {
      throw new Error(`强制发布的 ${key} 必须是 true 或 false`);
    }
    scope[key] = value === true || value === 'true';
  }
  // 新包装的是当前页面。服务器上的 /app/ 还是旧的时，热更新会在下次冷启动换回去。
  if (scope.apk) scope.app = true;
  // 部署脚本在重启服务时总会同步报名站。
  if (scope.server) scope.join = true;
  if (!scope.apk && !scope.server && !scope.app && !scope.join) {
    throw new Error('强制发布至少要选一项');
  }
  return scope;
}

/**
 * 强制发布只接受 master 上已经成功的推送检查。拉取请求的检查不算。
 *
 * @param {unknown} runs
 * @returns {{ ok: boolean, reason: string }}
 */
export function masterCiGate(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const pushes = list.filter((run) => run && run.event === 'push' && run.headBranch === 'master');
  if (pushes.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
    return { ok: true, reason: '' };
  }
  if (pushes.some((run) => run.status !== 'completed')) {
    return { ok: false, reason: 'master 上这次提交的 CI 还在跑，等它成功后再强制发布。' };
  }
  return { ok: false, reason: 'master 上这次提交还没有成功的 CI，不能强制发布。' };
}

/** @param {{ apk: boolean, server: boolean, app: boolean, join: boolean }} scope */
function writeScope(scope) {
  process.stdout.write(`apk=${scope.apk}\nserver=${scope.server}\napp=${scope.app}\njoin=${scope.join}\n`);
}

/**
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function parseForceArgs(args) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) {
      process.stderr.write('用法：node scripts/release-scope.mjs --force apk=true server=true app=true join=true\n');
      process.exit(2);
    }
    flags[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return flags;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--force') {
    try {
      writeScope(forceReleaseScope(parseForceArgs(args.slice(1))));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  } else if (args[0] === '--merge-commit') {
    const file = args[1];
    if (!file) {
      process.stderr.write('用法：node scripts/release-scope.mjs --merge-commit <commit.txt>\n');
      process.exit(2);
    }
    process.stdout.write(isMergeCommit(readFileSync(file, 'utf8')) ? 'merge\n' : 'skip\n');
  } else if (args[0] === '--ci-ok') {
    const file = args[1];
    if (!file) {
      process.stderr.write('用法：node scripts/release-scope.mjs --ci-ok <runs.json>\n');
      process.exit(2);
    }
    const gate = masterCiGate(JSON.parse(readFileSync(file, 'utf8')));
    if (!gate.ok) {
      process.stderr.write(`${gate.reason}\n`);
      process.exit(1);
    }
  } else {
    const file = args[0];
    if (!file) {
      process.stderr.write('用法：node scripts/release-scope.mjs <变更文件清单>\n');
      process.exit(2);
    }
    writeScope(releaseScope(readPaths(readFileSync(file, 'utf8'))));
  }
}
