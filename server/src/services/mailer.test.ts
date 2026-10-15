/**
 * 邮件发送适配层的单元测试。
 *
 * 只测 `memory` 与 `console` 两条通道：真发 SMTP 需要 Mailpit 在跑，那属于手动/本地验证
 * （`docker compose up -d mailpit` 后用契约用例打一发），不该让 `pnpm test`
 * 依赖一个容器。这里要钉住的是「失败不抛异常、注入被清掉、生产不许用 memory」。
 */

import assert from 'node:assert/strict';
import { resolveMailConfig } from '../config/mail.js';
import { send, outbox, lastMail, resetMailer, closeTransporter, buildMessage, formatFrom } from './mailer.js';

/** 内存收件箱配置：只有测试会用它。 */
const memoryConfig = (extra: Record<string, string> = {}) =>
  resolveMailConfig({
    NODE_ENV: 'test',
    MAIL_TRANSPORT: 'memory',
    ...extra,
  });

beforeEach(() => resetMailer());

test('memory 通道把邮件留在收件箱里，收件人 / 主题 / 正文 / 用途都在', async () => {
  const result = await send(
    {
      to: 'user@example.com',
      subject: '【发现展会】注册验证码',
      text: '验证码：123456',
      purpose: 'register',
    },
    { config: memoryConfig() },
  );

  assert.equal(result.ok, true);
  assert.equal(result.transport, 'memory');
  assert.ok(result.messageId?.startsWith('memory-'));

  const mail = lastMail();
  assert.equal(mail?.to, 'user@example.com');
  assert.equal(mail?.subject, '【发现展会】注册验证码');
  assert.ok(mail?.text.includes('123456'));
  assert.equal(mail?.purpose, 'register');
  assert.equal(outbox().length, 1);
});

test('console 通道把整封邮件打进日志：本地不开容器也能拿到验证码', async () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  let result;
  try {
    result = await send(
      {
        to: 'user@example.com',
        subject: '【发现展会】注册验证码',
        text: '验证码：654321',
        purpose: 'register',
      },
      { config: resolveMailConfig({ NODE_ENV: 'development' }) },
    );
  } finally {
    spy.mockRestore();
  }

  assert.equal(result.ok, true);
  assert.equal(result.transport, 'console');
  const output = lines.join('\n');
  assert.ok(output.includes('user@example.com'), '日志里要有收件人');
  assert.ok(output.includes('654321'), '日志里要有验证码，否则本地没法完成注册');
  assert.ok(output.includes('console'), '要说明这是 console 通道、没有真正发送');
  assert.equal(outbox().length, 0, 'console 通道不该往内存收件箱里塞东西');
});

test('通道没配好时不抛异常，返回 ok:false 并说清缺什么', async () => {
  // 生产 + 默认 smtp 且什么都没配：最典型的「上线忘了配」现场
  const broken = resolveMailConfig({ NODE_ENV: 'production' });
  const result = await send({ to: 'user@example.com', subject: '主题', text: '正文' }, { config: broken });
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes('MAIL_SMTP_HOST'), `原因要具体，实际：${result.error}`);
});

test('收件地址非法时不发信，也不进收件箱', async () => {
  const cases = [
    '',
    'not-an-email',
    'a b@example.com',
    'a@b\r\nBcc: evil@example.com',
    `${'x'.repeat(120)}@example.com`,
  ];
  for (const to of cases) {
    const result = await send({ to, subject: '主题', text: '正文' }, { config: memoryConfig() });
    assert.equal(result.ok, false, `${JSON.stringify(to)} 不该通过`);
  }
  assert.equal(outbox().length, 0);
});

test('主题与发件人名里的换行被清掉（邮件头注入）', () => {
  const config = memoryConfig({ MAIL_FROM_ADDRESS: 'no-reply@example.com' });
  const built = buildMessage(
    {
      to: 'user@example.com',
      subject: '主题\r\nBcc: evil@example.com',
      text: '正文',
      fromName: '发现展会\r\nBcc: evil@example.com',
    },
    config,
  );

  assert.ok(!/[\r\n]/.test(built.subject), '主题里不能有换行');
  assert.ok(!/[\r\n]/.test(built.from), '发件人里不能有换行');
  assert.ok(built.from.includes('no-reply@example.com'));
  assert.ok(built.from.startsWith('"发现展会'), '显示名要加引号，避免逗号等字符破坏地址');
});

test('formatFrom：显示名里的引号与尖括号被剥掉，缺显示名时只留地址', () => {
  assert.equal(formatFrom('a"b<c>', 'x@y.com'), '"abc" <x@y.com>');
  assert.equal(formatFrom('', 'x@y.com'), 'x@y.com');
  assert.equal(formatFrom(undefined, 'x@y.com'), 'x@y.com');
});

test('memory 通道在生产配置下被拒（纵深防御，绕不过去）', async () => {
  // 手工构造「生产 + memory」：resolveMailConfig 会降级，这里验证 send 自己也拦得住
  const forced = { ...memoryConfig(), isProduction: true };
  const result = await send({ to: 'user@example.com', subject: '主题', text: '正文' }, { config: forced });
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes('memory'));
  assert.equal(outbox().length, 0);
});

test('没建过连接池时 closeTransporter 是空操作，可反复调用', () => {
  assert.doesNotThrow(() => {
    closeTransporter();
    closeTransporter();
  });
});

test('resetMailer 清空收件箱，用例之间不互相污染', async () => {
  await send({ to: 'a@example.com', subject: 's', text: 't' }, { config: memoryConfig() });
  assert.equal(outbox().length, 1);
  resetMailer();
  assert.equal(outbox().length, 0);
  assert.equal(lastMail(), null);
});
