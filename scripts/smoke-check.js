/**
 * 仓库级冒烟检查入口：前端文案资源、WebView 模块与页面运行时、后端 TypeScript。
 * 数据库契约测试和 Android 构建按需单独运行，命令见 `docs/operations.md`。
 * 用法：node scripts/smoke-check.js
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function run(label, executable, args, options = {}) {
  console.log(`\n[${label}] ${executable} ${args.join(' ')}`);
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    shell: options.shell || false,
  });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  return result.status === 0;
}

function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 24) {
    console.error(`后端要求 Node.js >= 24.0.0，当前版本为 ${process.versions.node}`);
    process.exitCode = 1;
    return;
  }

  const steps = [
    ['前端文案', process.execPath, ['scripts/check-strings.js']],
    ['WebView 前端', process.execPath, ['scripts/webui-check.js']],
    [
      '后端类型检查',
      process.platform === 'win32'
        ? 'pnpm.cmd --dir server typecheck'
        : 'pnpm --dir server typecheck',
      [],
      { shell: process.platform === 'win32' },
    ],
  ];

  for (const [label, executable, args, options] of steps) {
    if (!run(label, executable, args, options)) {
      console.error(`冒烟检查失败：${label}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log('\n仓库级冒烟检查通过。');
}

main();
