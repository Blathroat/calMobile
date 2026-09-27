/** Vue 前端独立门禁：类型、单测和生产构建必须同时通过。 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'web');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const commands = [
  ['typecheck'],
  ['test'],
  ['build'],
];

for (const args of commands) {
  const result = spawnSync(pnpm, args, { cwd: web, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('PASS Vue Web 前端门禁');
