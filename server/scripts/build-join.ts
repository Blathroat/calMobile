/**
 * 构建浏览器报名站到仓库的 `web/dist-join`。
 *
 * 作为脚本入口时构建一次，失败则以非零退出。
 * `scripts/dev.ts` 必须先 `await buildJoinSite()`，再 import 服务：
 * 服务在加载时决定要不要托管这份产物。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntry } from '../src/entry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = path.join(repoRoot, 'web');
const viteBin = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteConfig = path.join(webRoot, 'vite.join.config.ts');

function spawnVite(extra: string[] = []): ChildProcess {
  if (!existsSync(viteBin)) {
    throw new Error(`没有找到 Vite：${viteBin}。请先在 web 目录执行 pnpm install。`);
  }
  return spawn(process.execPath, [viteBin, 'build', '--config', viteConfig, ...extra], {
    cwd: webRoot,
    env: { ...process.env, VITE_SURFACE: 'join' },
    stdio: 'inherit',
  });
}

/** 构建一次。Vite 非零退出时拒绝。 */
export function buildJoinSite(): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnVite();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`报名站构建失败，退出码 ${code ?? 'null'}`));
    });
  });
}

/**
 * 监听 `web/src` 并写回 `web/dist-join`。服务按请求读文件，不必为此再开一个端口。
 * 进程退出时关掉子进程，避免 tsx 重启后留下旧的 Vite。
 */
export function watchJoinSite(): ChildProcess {
  const child = spawnVite(['--watch']);
  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.on('exit', stop);
  child.on('exit', (code, signal) => {
    if (signal || code === 0 || code === null) return;
    console.error(`报名站监听构建退出，码 ${code}`);
  });
  return child;
}

if (isEntry(import.meta.url)) {
  buildJoinSite().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
