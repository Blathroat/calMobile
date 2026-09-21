/**
 * 邮件通道配置的单元测试：默认值、生产降级、非法通道名、端口与 TLS 推导、密码不外泄。
 *
 * 用纯函数 `resolveMailConfig(env)` 直接喂环境，不去改 `process.env` 再重新 require ——
 * 后者在 runner 的模块缓存下极易互相污染。
 */

const assert = require('node:assert/strict');

const { resolveMailConfig, describeMailConfig, TRANSPORTS } = require('./mail');

test('开发环境不配通道时走 console：不需要任何邮件配置就能开发', () => {
  const config = resolveMailConfig({ NODE_ENV: 'development' });
  assert.equal(config.transport, 'console');
  assert.equal(config.configured, true);
  assert.deepEqual(config.problems, []);
});

test('生产环境不配通道时默认 smtp，并把缺失项逐条指出来', () => {
  const config = resolveMailConfig({ NODE_ENV: 'production' });
  assert.equal(config.transport, 'smtp');
  assert.equal(config.configured, false);
  assert.ok(
    config.problems.some((item) => item.includes('MAIL_SMTP_HOST')),
    `应当指出缺少 SMTP 主机，实际：${config.problems.join('；')}`,
  );
  assert.ok(
    config.problems.some((item) => item.includes('MAIL_FROM_ADDRESS')),
    `应当指出缺少发件人地址，实际：${config.problems.join('；')}`,
  );
});

test('生产环境显式配 memory 会被拒绝并降级为 smtp', () => {
  const config = resolveMailConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'memory' });
  assert.equal(config.transport, 'smtp', 'memory 在生产必须被降级，否则用户永远收不到码');
  assert.equal(config.configured, false);
  assert.ok(config.problems.some((item) => item.includes('memory')));
});

test('通道名写错会被指出，并回退到该环境的默认通道', () => {
  const dev = resolveMailConfig({ NODE_ENV: 'development', MAIL_TRANSPORT: 'sendmail' });
  assert.equal(dev.transport, 'console');
  assert.ok(dev.problems.some((item) => item.includes('sendmail')));

  const prod = resolveMailConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'sendmail' });
  assert.equal(prod.transport, 'smtp');
});

test('端口默认 587；465 按隐式 TLS；显式配置优先；非法端口退回默认', () => {
  assert.equal(resolveMailConfig({}).smtp.port, 587);
  assert.equal(resolveMailConfig({ MAIL_SMTP_PORT: '465' }).smtp.secure, true);
  assert.equal(resolveMailConfig({ MAIL_SMTP_PORT: '465', MAIL_SMTP_SECURE: 'false' }).smtp.secure, false);
  assert.equal(resolveMailConfig({ MAIL_SMTP_PORT: '1025' }).smtp.secure, false, 'Mailpit 这类本地中继不是隐式 TLS');
  assert.equal(resolveMailConfig({ MAIL_SMTP_PORT: 'abc' }).smtp.port, 587);
  assert.equal(resolveMailConfig({ MAIL_SMTP_PORT: '70000' }).smtp.port, 587);
});

test('SMTP 配了用户却没配密码会被指出', () => {
  const config = resolveMailConfig({
    NODE_ENV: 'production',
    MAIL_SMTP_HOST: 'smtp.example.com',
    MAIL_SMTP_USER: 'apikey',
    MAIL_FROM_ADDRESS: 'no-reply@example.com',
  });
  assert.equal(config.configured, false);
  assert.ok(config.problems.some((item) => item.includes('MAIL_SMTP_PASSWORD')));
});

test('证书默认校验，只有显式关闭才放行自签名中继', () => {
  assert.equal(resolveMailConfig({ MAIL_SMTP_HOST: 'h' }).smtp.rejectUnauthorized, true);
  assert.equal(
    resolveMailConfig({ MAIL_SMTP_HOST: 'h', MAIL_SMTP_TLS_REJECT_UNAUTHORIZED: 'false' }).smtp.rejectUnauthorized,
    false,
  );
});

test('配齐的 SMTP 配置算「已配置」，开发默认发件人带点（合法邮箱）', () => {
  const config = resolveMailConfig({
    NODE_ENV: 'production',
    MAIL_SMTP_HOST: 'smtp.example.com',
    MAIL_SMTP_PORT: '465',
    MAIL_SMTP_USER: 'apikey',
    MAIL_SMTP_PASSWORD: 'secret',
    MAIL_FROM_ADDRESS: 'no-reply@example.com',
    MAIL_REPLY_TO: 'support@example.com',
  });
  assert.equal(config.configured, true);
  assert.deepEqual(config.problems, []);
  assert.match(resolveMailConfig({ NODE_ENV: 'development' }).fromAddress, /@[^@]+\.[^@]+$/);
});

test('describe() 供状态页使用，且不泄露 SMTP 密码', () => {
  const config = resolveMailConfig({
    NODE_ENV: 'production',
    MAIL_SMTP_HOST: 'smtp.example.com',
    MAIL_SMTP_USER: 'apikey',
    MAIL_SMTP_PASSWORD: 'super-secret-value',
    MAIL_FROM_ADDRESS: 'no-reply@example.com',
  });
  const described = describeMailConfig(config);
  assert.equal(described.configured, true);
  assert.equal(described.transport, 'smtp');
  assert.equal(described.smtpHost, 'smtp.example.com');
  assert.equal(described.smtpAuth, true, '只说明「有认证」，不给凭据');
  assert.ok(!JSON.stringify(described).includes('super-secret-value'), '状态页绝不能带上密码');
});

test('通道清单就是这三种，改动必须同步文档', () => {
  assert.deepEqual(TRANSPORTS, ['console', 'smtp', 'memory']);
});
