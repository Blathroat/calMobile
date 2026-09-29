/** Vue WebView 前端检查入口。 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'web');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (!fs.existsSync(path.join(webRoot, 'package.json'))) {
  console.error(`没有找到 Vue 前端工程：${path.relative(root, webRoot)}`);
  process.exit(1);
}

for (const command of [['typecheck'], ['test'], ['build']]) {
  const result = spawnSync(pnpm, command, { cwd: webRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('Vue 前端检查通过。');
