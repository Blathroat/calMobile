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
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (!(nodeMajor >= 26 || (nodeMajor === 24 && nodeMinor >= 15))) {
    console.error(`要求 Node.js 24.15+（24.x）或 26+，当前版本为 ${process.versions.node}`);
    process.exitCode = 1;
    return;
  }

  // pnpm 的调用方式按平台分开：Windows 上是 `pnpm.cmd`（需要 shell），
  // Linux/macOS 上是 `pnpm`。**脚本必须以命令名 + 参数数组的形式传**，
  // 把整条命令塞进 executable 只在 Windows 的 shell 模式下成立，
  // 在 CI 的 Linux 上会直接 `spawnSync ... ENOENT`。
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const steps = [
    ['前端文案', process.execPath, ['scripts/check-strings.js']],
    ['WebView 前端', process.execPath, ['scripts/webui-check.js']],
    ['后端类型检查', pnpm, ['--dir', 'server', 'typecheck'], { shell: process.platform === 'win32' }],
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
