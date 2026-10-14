/** 开发入口：状态页源码变化时由 tsx 重启，重启前重新生成内联资源。 */
await import('./build-status-page.ts');
// 报名站必须在加载服务之前构建完：服务在 import 时决定托管目录。
const { buildJoinSite, watchJoinSite } = await import('./build-join.ts');
await buildJoinSite();
const { adbReverseDisabled, watchAdbReverse } = await import('../src/dev/adb-reverse.ts');
const { resolveProcessSettings } = await import('../src/config/env.ts');

// 模拟器/真机连不上后端的常见原因不是服务没起，而是 `adb reverse` 的映射丢了（见模块注释）。
// 这里顺手接上并持续看护，让「只跑 pnpm dev」也能直接用应用调试。
// 只取端口，不做完整的启动自检——那是 `start()` 的事。
const { port } = resolveProcessSettings(process.env);
if (adbReverseDisabled(process.env)) {
  console.log(`ADB_REVERSE 已关闭：需要时手动运行 adb reverse tcp:${port} tcp:${port}`);
} else {
  watchAdbReverse({ port });
}

const { start } = await import('../src/index.ts');
watchJoinSite();
await start();
