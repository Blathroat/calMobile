/**
 * 运行环境判定的单元测试。
 *
 * `resolveRuntime` 是纯函数（argv + env 进、结论出），所以「pnpm start 进生产」这件事
 * 不必真的去启动一次服务：只要钉住优先级，`package.json` 的脚本传对参数就够了。
 */

import assert from 'node:assert/strict';
import { resolveRuntime } from './runtime.js';

/** 造一个 argv：第一个元素是 node，第二个是脚本路径，其余是脚本参数。 */
const argv = (...args: string[]) => ['node', 'src/index.js', ...args];

test('pnpm start 传 --production：自动进生产模式', () => {
  const runtime = resolveRuntime(argv('--production'), { NODE_ENV: 'development' });
  assert.equal(runtime.nodeEnv, 'production');
  assert.equal(runtime.isProduction, true, '--production 必须压过 .env 里的 development');
});

test('pnpm dev 不带参数：留在开发模式', () => {
  const runtime = resolveRuntime(argv(), { NODE_ENV: 'development', npm_lifecycle_event: 'dev' });
  assert.equal(runtime.nodeEnv, 'development');
  assert.equal(runtime.isProduction, false);
  assert.equal(runtime.startedBy, 'dev');
});

test('真实环境变量优先于 .env（容器里注入 NODE_ENV 也能生效）', () => {
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'production' }).nodeEnv, 'production');
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'test' }).nodeEnv, 'test');
});

test('什么都没配时默认 development（而不是悄悄当成生产）', () => {
  const runtime = resolveRuntime(argv(), {});
  assert.equal(runtime.nodeEnv, 'development');
  assert.equal(runtime.isProduction, false);
});

test('两个环境参数同时给是操作失误，直接报错', () => {
  assert.throws(() => resolveRuntime(argv('--production', '--development'), {}), /不能同时指定/);
});

test('状态页：生产默认关闭，其它环境默认打开，显式配置优先', () => {
  assert.equal(resolveRuntime(argv('--production'), {}).statusPageEnabled, false);
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'development' }).statusPageEnabled, true);
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'test' }).statusPageEnabled, true);
  assert.equal(resolveRuntime(argv('--production'), { ENABLE_STATUS_PAGE: 'true' }).statusPageEnabled, true);
  assert.equal(
    resolveRuntime(argv(), { NODE_ENV: 'development', ENABLE_STATUS_PAGE: 'false' }).statusPageEnabled,
    false,
  );
});

test('探针默认都开，健康检查与报名站只在非生产默认打开', () => {
  const production = resolveRuntime(argv('--production'), {});
  assert.equal(production.pingEnabled, true);
  assert.equal(production.healthEnabled, false);
  assert.equal(production.webEnabled, false);

  const development = resolveRuntime(argv(), { NODE_ENV: 'development' });
  assert.equal(development.pingEnabled, true);
  assert.equal(development.healthEnabled, true);
  assert.equal(development.webEnabled, true);
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'test' }).webEnabled, true);

  assert.equal(resolveRuntime(argv('--production'), { ENABLE_WEB: 'true' }).webEnabled, true);
  assert.equal(resolveRuntime(argv('--production'), { ENABLE_HEALTH: '1' }).healthEnabled, true);
  assert.equal(resolveRuntime(argv(), { ENABLE_PING: 'false' }).pingEnabled, false);
  assert.equal(resolveRuntime(argv(), { NODE_ENV: 'development', ENABLE_WEB: 'off' }).webEnabled, false);
});

test('trust proxy 默认关闭，只有显式声明才打开', () => {
  assert.equal(resolveRuntime(argv(), {}).trustProxy, false);
  assert.equal(resolveRuntime(argv(), { TRUST_PROXY: 'false' }).trustProxy, false);
  assert.equal(resolveRuntime(argv(), { TRUST_PROXY: '1' }).trustProxy, 1, '一跳反代用数字');
  assert.equal(resolveRuntime(argv(), { TRUST_PROXY: 'loopback' }).trustProxy, 'loopback', '也接受常见的来源写法');
});

test('--prod 是 --production 的简写，npm_lifecycle_event 只用于日志', () => {
  assert.equal(resolveRuntime(argv('--prod'), {}).isProduction, true);
  assert.equal(resolveRuntime(argv(), { npm_lifecycle_event: 'start' }).startedBy, 'start');
});
