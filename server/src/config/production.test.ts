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
    TOTP_SECRET_KEY: 'b'.repeat(40),
    DB_PASSWORD: 'not-the-default-password',
    MAIL_TRANSPORT: 'smtp',
    MAIL_SMTP_HOST: 'smtp.example.com',
    MAIL_SMTP_PORT: '465',
    MAIL_FROM_ADDRESS: 'no-reply@mail.example.com',
    CORS_ORIGIN: 'https://appassets.androidplatform.net',
    TRUST_PROXY: '1',
    LOG_LEVEL: 'info',
    ADMIN_USERNAME: 'opsadmin',
    ADMIN_PASSWORD: 'correct-horse-battery',
    ADMIN_EMAIL: 'ops@mail.example.com',
    ...override,
  };
}

const fatalOf = (env: NodeJS.ProcessEnv | Record<string, string | undefined>) =>
  productionProblems(env).fatal.join('；');

test('配齐的生产环境没有任何致命项', () => {
  const { fatal } = productionProblems(readyEnv());
  assert.deepEqual(fatal, [], `不该有致命项：${fatal.join('；')}`);
});

test('开发用的访问令牌与 TOTP 密钥会被拒绝启动', () => {
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'calmobile-local-dev-access-secret-please-change-32' })), /JWT_SECRET/);
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'your_access_secret_here_replace_me_now' })), /JWT_SECRET/);
  assert.match(fatalOf(readyEnv({ JWT_SECRET: 'short' })), /少于 32/);
  assert.match(fatalOf(readyEnv({ TOTP_SECRET_KEY: '' })), /TOTP_SECRET_KEY 没有配置/);
  assert.match(fatalOf(readyEnv({ TOTP_SECRET_KEY: 'short' })), /TOTP_SECRET_KEY 少于 32/);
  assert.match(
    fatalOf(readyEnv({ TOTP_SECRET_KEY: 'replace-with-a-totp-secret-0123456789012345' })),
    /TOTP_SECRET_KEY 还是开发用的值/,
  );
});

test('数据库密码还是 postgres 会很直白地被拦下', () => {
  assert.match(fatalOf(readyEnv({ DB_PASSWORD: 'postgres' })), /示例密码/);
  assert.match(fatalOf(readyEnv({ DB_PASSWORD: '' })), /DB_PASSWORD 没有配置/);
});

test('生产管理员账号缺失或仍是示例口令会被拒绝，文案不含口令本身', () => {
  assert.match(fatalOf(readyEnv({ ADMIN_USERNAME: '' })), /ADMIN_USERNAME 没有配置/);
  assert.match(fatalOf(readyEnv({ ADMIN_USERNAME: '中文名' })), /3–20/);
  assert.match(fatalOf(readyEnv({ ADMIN_PASSWORD: '' })), /ADMIN_PASSWORD 没有配置/);
  assert.match(fatalOf(readyEnv({ ADMIN_PASSWORD: 'short' })), /12–32/);
  const weak = fatalOf(readyEnv({ ADMIN_PASSWORD: 'password' }));
  assert.match(weak, /示例或占位密码/);
  assert.equal(weak.includes('password'), false);
  assert.match(fatalOf(readyEnv({ ADMIN_EMAIL: '' })), /ADMIN_EMAIL 没有配置/);
  assert.match(fatalOf(readyEnv({ ADMIN_EMAIL: 'ops@example.com' })), /不能使用/);
  assert.match(fatalOf(readyEnv({ ADMIN_EMAIL: 'ops@calmobile.local' })), /不能使用/);
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
      ENABLE_HEALTH: 'true',
      ENABLE_PING: 'false',
    }),
  );
  assert.deepEqual(fatal, [], '这些都不该拦启动');
  const text = warnings.join('；');
  assert.match(text, /Mailpit/);
  assert.match(text, /CORS_ORIGIN/);
  assert.match(text, /TRUST_PROXY/);
  assert.match(text, /LOG_LEVEL=debug/);
  assert.match(text, /ENABLE_STATUS_PAGE/);
  assert.match(text, /ENABLE_HEALTH/);
  assert.match(text, /ENABLE_PING/);
  assert.match(text, /报名站/);
});

test('默认语言包名称不在下载列表里时只警告，不拒绝启动', () => {
  const { fatal, warnings } = productionProblems(
    readyEnv({
      LANG_PACK_DEFAULT: 'en',
      LANG_PACK_URLS: 'ja=https://example.com/ja.json',
    }),
  );
  assert.deepEqual(fatal, []);
  assert.match(warnings.join('；'), /报名站继续用中文/);
});

test('正式包地址、报名站开关和隐私政策链接只警告', () => {
  const missing = productionProblems(readyEnv()).warnings.join('；');
  assert.match(missing, /APP_API_BASE 没有配置/);
  assert.match(missing, /PRIVACY_POLICY_URL 没有配置/);

  const wrong = productionProblems(
    readyEnv({
      APP_API_BASE: 'http://127.0.0.1:3000/api/v1',
      PUBLIC_BASE_URL: 'https://app.example.com',
      PRIVACY_POLICY_URL: 'http://app.example.com/privacy',
    }),
  ).warnings.join('；');
  assert.match(wrong, /不是 https/);
  assert.match(wrong, /ENABLE_WEB/);
  assert.match(wrong, /PRIVACY_POLICY_URL/);

  const split = productionProblems(
    readyEnv({
      APP_API_BASE: 'https://api.example.com/api/v1',
      PUBLIC_BASE_URL: 'https://app.example.com',
      ENABLE_WEB: 'true',
      PRIVACY_POLICY_URL: 'https://app.example.com/privacy',
    }),
  ).warnings.join('；');
  assert.match(split, /不是同一个源/);
  assert.doesNotMatch(split, /ENABLE_WEB/);

  const ready = productionProblems(
    readyEnv({
      APP_API_BASE: 'https://app.example.com/api/v1',
      PUBLIC_BASE_URL: 'https://app.example.com',
      ENABLE_WEB: 'true',
      PRIVACY_POLICY_URL: 'https://app.example.com/privacy',
    }),
  );
  assert.deepEqual(ready.fatal, []);
  assert.equal(
    ready.warnings.some((item) => /APP_API_BASE|PRIVACY_POLICY_URL|ENABLE_WEB/.test(item)),
    false,
  );
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
