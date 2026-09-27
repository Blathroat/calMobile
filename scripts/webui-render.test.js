/** Vue 前端渲染门禁的 Node 入口。 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

test('Vue Web 工程可以通过类型检查', () => {
  const result = spawnSync(pnpm, ['typecheck'], { cwd: path.join(root, 'web'), encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
});
