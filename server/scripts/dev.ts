/** 开发入口：状态页源码变化时由 tsx 重启，重启前重新生成内联资源。 */
await import('./build-status-page.ts');
const { start } = await import('../src/index.ts');
await start();
