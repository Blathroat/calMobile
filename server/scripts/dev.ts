/** 开发入口：状态页源码变化时由 tsx 重启，重启前重新生成内联资源。 */
await import('./build-status-page.ts');
// 报名站必须在加载服务之前构建完：服务在 import 时决定托管目录。
const { buildJoinSite, watchJoinSite } = await import('./build-join.ts');
await buildJoinSite();
const { adbReverseDisabled, watchAdbReverse } = await import('../src/dev/adb-reverse.ts');
const { loadBuildEnv, resolveClientTarget } = await import('../../scripts/client-target.mjs');

// 模拟器/真机连不上后端的常见原因不是服务没起，而是 `adb reverse` 的映射丢了（见模块注释）。
// 端口跟应用包里的接口地址走：没配 APP_API_BASE 时就是 PORT。公网地址不需要这条映射。
const target = resolveClientTarget(loadBuildEnv());
const port = target.loopbackPort;
if (adbReverseDisabled(process.env)) {
  const shown = port ?? '端口';
  console.log(`ADB_REVERSE 已关闭：需要时手动运行 adb reverse tcp:${shown} tcp:${shown}`);
} else if (port === null) {
  console.log(`APP_API_BASE=${target.apiBase} 不是本机地址，跳过 adb reverse`);
} else {
  watchAdbReverse({ port });
}

const { start } = await import('../src/index.ts');
watchJoinSite();
await start();
