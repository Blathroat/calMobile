/**
 * Vue 前端渲染门禁的 Node 入口。
 *
 * 逐屏结构由 `web/src/app/shell.test.ts` 断言（外壳、底部导航、页脚槽、内容区密度），
 * 这里只负责跑整个 vitest 套件，让 CI 的 `node --test scripts/webui-render.test.js`
 * 与 `node scripts/webui-check.js` 覆盖同一批用例。
 * 新增页面时在 `web/src/app/router.ts` 注册路由，并把路径加进该用例的 `ROUTES`。
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

test('Vue Web 渲染门禁通过', () => {
  const result = spawnSync(pnpm, ['test'], { cwd: path.join(root, 'web'), encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});
