/**
 * WebView 前端检查入口。
 *
 * 先让 Node 解析每个内置前端模块，再用真实 DOM 打桩与假后端渲染页面、验证请求接线。
 * 不通过读取源码字符串猜页面行为；运行时覆盖由 `webui-render.test.js` 负责。
 * 用法：node scripts/webui-check.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'app', 'src', 'main', 'assets', 'web', 'js');

function collectModules(directory) {
  const modules = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...collectModules(file));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      modules.push(file);
    }
  }
  return modules;
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    return false;
  }
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  return true;
}

function main() {
  const modules = collectModules(webRoot);
  if (modules.length === 0) {
    console.error(`没有找到前端模块：${path.relative(root, webRoot)}`);
    process.exitCode = 1;
    return;
  }

  for (const file of modules) {
    if (!runNode(['--check', file])) {
      console.error(`前端模块解析失败：${path.relative(root, file)}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`前端模块语法通过（${modules.length} 个模块；第三方 vendor 按内置依赖管理）。`);

  if (!runNode(['--test', 'scripts/webui-render.test.js'])) {
    process.exitCode = 1;
  }
}

main();
