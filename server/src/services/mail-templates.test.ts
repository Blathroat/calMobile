/**
 * 验证码邮件文案的单元测试：五种用途、双语、码与有效期都在、以及两个注入面
 * （品牌名进 HTML 要转义、进主题要清换行）。
 */

import assert from 'node:assert/strict';
import { verificationMail, PURPOSE_KEYS, PURPOSES, escapeHtml, sanitizeHeader } from './mail-templates.js';

const BRAND = { zh: '发现展会', en: 'ExpoHub' };

test('五种用途都能生成中英双语邮件，主题带品牌中文名与用途', () => {
  for (const purpose of PURPOSE_KEYS) {
    const mail = verificationMail({
      purpose,
      code: '123456',
      expiresInMin: 10,
      brand: BRAND,
    });
    const label = PURPOSES[purpose as keyof typeof PURPOSES];
    assert.ok(mail.subject.includes('发现展会'), `${purpose} 的主题缺品牌名`);
    assert.ok(mail.subject.includes(label.zh), `${purpose} 的主题缺用途`);
    assert.ok(mail.text.includes('ExpoHub'), `${purpose} 的正文缺英文品牌`);
    assert.ok(mail.text.includes(label.en), `${purpose} 的正文缺英文用途`);
    assert.ok(mail.html.includes('ExpoHub'));
    assert.ok(mail.text.length > 0 && mail.html.length > 0);
  }
});

test('验证码在纯文本与 HTML 里都出现（中英各一处），有效期跟着 TTL 走', () => {
  const mail = verificationMail({
    purpose: 'register',
    code: '246810',
    expiresInMin: 15,
    brand: BRAND,
  });
  // 中文段 + 英文段各一处，所以至少两处；用例只钉「不少于一次」，不绑死排版
  assert.ok(mail.text.split('246810').length - 1 >= 2, '纯文本里中英两段都要有码');
  assert.ok(mail.html.split('246810').length - 1 >= 2, 'HTML 里中英两段都要有码');
  assert.ok(mail.text.includes('15 分钟'));
  assert.ok(mail.html.includes('15 分钟'));
  assert.ok(mail.html.includes('15 minutes') || mail.html.includes('expires in 15'));
});

test('有效期缺省是 10 分钟，非法值同样退回 10', () => {
  assert.ok(verificationMail({ purpose: 'reset', code: '111111' }).text.includes('10 分钟'));
  assert.ok(verificationMail({ purpose: 'reset', code: '111111', expiresInMin: 0 }).text.includes('10 分钟'));
});

test('品牌名里的 HTML 被转义，不会注入正文', () => {
  const mail = verificationMail({
    purpose: 'register',
    code: '123456',
    brand: { zh: '<script>alert(1)</script>', en: 'X' },
  });
  assert.ok(!mail.html.includes('<script>'), '品牌名不能原样进 HTML');
  assert.ok(mail.html.includes('&lt;script&gt;'));
});

test('品牌名里的换行不会进主题：那是邮件头注入', () => {
  const mail = verificationMail({
    purpose: 'register',
    code: '123456',
    brand: { zh: '发现展会\r\nBcc: evil@example.com', en: 'ExpoHub' },
  });
  // 真正的性质是「主题只有一个物理行」：换行被压成空格后，注入的文本留在同一行，
  // 无法变成第二个邮件头。（断言「不含 Bcc」是错的——清洗后它仍以普通文本存在。）
  assert.ok(!/[\r\n]/.test(mail.subject), '主题里不能有换行');
  assert.equal(mail.subject.split('\n').length, 1);
  assert.ok(mail.subject.startsWith('【发现展会 Bcc: evil@example.com】'), '注入文本只能作为普通文字留在同一行');
});

test('主题不出现「验证验证」这类叠字，且都以「验证码」收尾', () => {
  // 用途标签自带「验证」时（开启两步验证）直接拼「验证码」会写成「开启两步验证验证码」，
  // 这是真机上第一封测试邮件就暴露出来的文案 bug。
  for (const purpose of PURPOSE_KEYS) {
    const mail = verificationMail({ purpose, code: '123456', brand: BRAND });
    assert.ok(!mail.subject.includes('验证验证'), `${purpose} 的主题叠字了：${mail.subject}`);
    assert.ok(!mail.subject.includes('码码'), `${purpose} 的主题叠字了：${mail.subject}`);
    assert.ok(mail.subject.endsWith('验证码'), `${purpose} 的主题应以「验证码」收尾：${mail.subject}`);
  }
});

test('验证码格式不对直接抛错：宁可不发，也不发一封没有码的邮件', () => {
  assert.throws(() => verificationMail({ purpose: 'register' }), /4-8 位数字/);
  assert.throws(() => verificationMail({ purpose: 'register', code: '12' }), /4-8 位数字/);
  assert.throws(() => verificationMail({ purpose: 'register', code: 'abcdef' }), /4-8 位数字/);
  assert.throws(() => verificationMail({ purpose: 'register', code: '12 3456' }), /4-8 位数字/);
});

test('未知用途退回注册文案，而不是抛错', () => {
  const mail = verificationMail({ purpose: 'unknown-purpose', code: '123456', brand: BRAND });
  assert.ok(mail.subject.includes(PURPOSES.register.zh));
});

test('正文里不放链接：带链接会拉低送达率，也养成点邮件链接的坏习惯', () => {
  for (const purpose of PURPOSE_KEYS) {
    const mail = verificationMail({
      purpose,
      code: '123456',
      brand: BRAND,
    });
    assert.ok(!/https?:\/\//i.test(mail.text), `${purpose} 的纯文本里不该有链接`);
    assert.ok(!/<a\s/i.test(mail.html), `${purpose} 的 HTML 里不该有 <a>`);
    assert.ok(!/<img\s/i.test(mail.html), `${purpose} 的 HTML 里不该有外部图片`);
  }
});

test('escapeHtml 与 sanitizeHeader 的边界', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(sanitizeHeader('  发现展会  '), '发现展会');
  assert.equal(sanitizeHeader('a\r\nb'), 'a b');
  assert.equal(sanitizeHeader('\u0000a\u007fb'), 'ab');
  assert.equal(sanitizeHeader('', '兜底'), '兜底');
  assert.equal(sanitizeHeader('   ', '兜底'), '兜底');
});
