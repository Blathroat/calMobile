/**
 * 生产环境启动自检的单元测试。
 *
 * 这里断言的是「哪些配置会被拒绝启动」—— 判错的代价很大：太松会把开发密钥带上线，
 * 太紧会让一次正常的部署起不来，所以每一档都写清楚理由。
 */

import assert from 'node:assert/strict';
import { productionProblems } from './production.js';

/** 一份「配齐了」的生产环境，用例按需覆盖其中某一项。 */
function readyEnv(override = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    DB_PASSWORD: 'not-the-default-password',
    MAIL_TRANSPORT: 'smtp',
    MAIL_SMTP_HOST: 'smtp.example.com',
    MAIL_SMTP_PORT: '465',
    MAIL_FROM_ADDRESS: 'no-reply@mail.example.com',
    CORS_ORIGIN: 'https://appassets.androidplatform.net',
    TRUST_PROXY: '1',
    LOG_LEVEL: 'info',
    ...override,
  };
}

const fatalOf = (env: NodeJS.ProcessEnv | Record<string, string | undefined>) =>
  productionProblems(env).fatal.join('；');

test('配齐的生产环境没有任何致命项', () => {
  const { fatal } = productionProblems(readyEnv());
  assert.deepEqual(fatal, [], `不该有致命项：${fatal.join('；')}`);
});

test('开发用的 JWT 密钥会被拒绝启动', () => {
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'calmobile-local-dev-access-secret-please-change-32' })), /JWT_SECRET/);
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'your_access_secret_here_replace_me_now' })), /JWT_SECRET/);
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'short' })), /少于 32/);
  assert.match(fatalOf(readyEnv({ JWT_REFRESH_SECRET: '' })), /JWT_REFRESH_SECRET 没有配置/);
});

test('数据库密码还是 postgres 会很直白地被拦下', () => {
  assert.match(fatalOf(readyEnv({ DB_PASSWORD: 'postgres' })), /示例密码/);
  assert.match(fatalOf(readyEnv({ DB_PASSWORD: '' })), /DB_PASSWORD 没有配置/);
});

test('验证码发不出去的配置会被拒绝启动', () => {
  // 只写日志：注册、找回密码、两步验证整条链路都会静默失效
  assert.match(fatalOf(readyEnv({ MAIL_TRANSPORT: 'console' })), /永远收不到/);
  assert.match(fatalOf(readyEnv({ MAIL_TRANSPORT: 'memory' })), /测试用的通道/);
  assert.match(fatalOf(readyEnv({ MAIL_FROM_ADDRESS: '' })), /MAIL_FROM_ADDRESS 没有配置/);
  assert.match(fatalOf(readyEnv({ MAIL_FROM_ADDRESS: 'no-reply@calmobile.local' })), /占位地址/);
});

test('可疑但可能有意为之的只给警告，不拦启动', () => {
  const { fatal, warnings } = productionProblems(
    readyEnv({
      MAIL_SMTP_HOST: '127.0.0.1',
      MAIL_SMTP_PORT: '1025',
      CORS_ORIGIN: '*',
      TRUST_PROXY: '',
      LOG_LEVEL: 'debug',
      ENABLE_STATUS_PAGE: 'true',
    }),
  );
  assert.deepEqual(fatal, [], '这些都不该拦启动');
  const text = warnings.join('；');
  assert.match(text, /Mailpit/);
  assert.match(text, /CORS_ORIGIN/);
  assert.match(text, /TRUST_PROXY/);
  assert.match(text, /LOG_LEVEL=debug/);
  assert.match(text, /ENABLE_STATUS_PAGE/);
});

test('远端数据库没开 SSL 会提醒（同机 Docker 不提醒）', () => {
  const remote = productionProblems(readyEnv({ DB_HOST: 'db.internal.example.com' })).warnings.join('；');
  assert.match(remote, /DB_SSL/);
  const local = productionProblems(readyEnv({ DB_HOST: '127.0.0.1' })).warnings.join('；');
  assert.doesNotMatch(local, /DB_SSL/);
});

test('警告与致命项各自独立：一边拦启动不妨碍另一边继续收集', () => {
  const { fatal, warnings } = productionProblems({
    JWT_SECRET: 'dev-local-dev',
    CORS_ORIGIN: '*',
  });
  assert.ok(fatal.length >= 3, `缺密钥、缺库密码、发信配置都要报出来：${fatal.join('；')}`);
  assert.ok(warnings.some((item: string) => item.includes('CORS_ORIGIN')));
});
