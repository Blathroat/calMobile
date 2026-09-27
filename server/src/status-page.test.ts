import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderStatusPage } from './status-page.js';

class Element {
  textContent = '';
  innerHTML = '';
  hidden = false;
  className = '';
  title = '';
  checked = true;
  private readonly attributes: Record<string, string>;

  constructor(attributes: Record<string, string> = {}) {
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  addEventListener(): void {}
}

function executePage(html: string): Record<string, Element> {
  const ids = [
    'badge',
    'alert',
    'db-error',
    'auto',
    'refresh',
    'service-name',
    'service-version',
    'updated',
    'svc-node',
    'svc-uptime',
    'svc-tz',
    'svc-now',
    'svc-started',
    'db-state',
    'db-latency',
    'db-version',
    'db-name',
    'db-host',
    'db-pool',
    'migrations-summary',
    'migrations-applied-count',
    'migrations-pending-count',
    'migrations-applied',
    'migrations-pending',
    'checks',
    'checks-count',
    'endpoints',
    'endpoints-count',
  ];
  const elements: Record<string, Element> = Object.fromEntries(ids.map((id) => [id, new Element()]));
  at(elements, 'auto').checked = true;
  const counts = ['users', 'exhibitions', 'registrations', 'exhibition_fields', 'app_settings'].map(
    (key) => new Element({ 'data-count': key }),
  );
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, '页面必须有内联脚本');
  const document = {
    hidden: false,
    getElementById(id: string): Element {
      return elements[id] || new Element();
    },
    querySelectorAll(selector: string): Element[] {
      return selector === '[data-count]' ? counts : [];
    },
    addEventListener(): void {},
  };
  vm.runInNewContext(script, {
    document,
    setInterval: () => 1,
    clearInterval: () => undefined,
    fetch: async () => ({ json: async () => ({}) }),
    console,
  });
  return elements;
}

function at(elements: Record<string, Element>, id: string): Element {
  const element = elements[id];
  assert.ok(element, `缺少元素 ${id}`);
  return element;
}

test('坏报告由内联客户端脚本渲染为通用错误且不泄露原文', () => {
  const raw = 'connect ECONNREFUSED 127.0.0.1:5432; SELECT password FROM users; Error: at pool.js:20';
  const html = renderStatusPage({
    ok: false,
    service: { name: 'calmobile-server', version: '1.0.0', timeZone: 'UTC' },
    database: { connected: false, error: raw, pool: {} },
    migrations: { applied: [], pending: ['0001-core'], error: raw },
    data: { users: null, exhibitions: null },
    checks: [
      { name: '数据库连通', status: 'fail', detail: raw, ms: 1 },
      { name: '查询检查', status: 'fail', detail: 'SELECT password FROM users; UPDATE users SET role = admin', ms: 2 },
      { name: '异常栈', status: 'ok', detail: 'TypeError: secret at pool.js:20', ms: 3 },
    ],
    endpoints: [],
  });
  assert.equal(html.includes(raw), false, 'INITIAL 和页面壳都不能带数据库原文');
  const elements = executePage(html);
  assert.equal(at(elements, 'badge').textContent, '异常');
  assert.equal(at(elements, 'alert').textContent, '数据库暂时不可用，请查看服务端日志');
  assert.equal(at(elements, 'db-error').textContent, '数据库暂时不可用，请查看服务端日志');
  assert.equal(at(elements, 'migrations-summary').textContent, '迁移状态暂时不可用，请查看服务端日志');
  assert.equal(at(elements, 'checks').innerHTML.includes(raw), false);
  assert.equal(at(elements, 'checks').innerHTML.includes('检查失败，请查看服务端日志'), true);
  assert.equal(at(elements, 'checks').innerHTML.includes('SELECT password'), false);
  assert.equal(at(elements, 'checks').innerHTML.includes('TypeError: secret'), false);
  assert.equal(at(elements, 'migrations-pending').innerHTML.includes('0001-core'), true);
});

test('INITIAL 注入不会解释替换字符串中的美元占位符', () => {
  const html = renderStatusPage({ ok: true, service: { name: '$&', now: "$`-$'" } });
  assert.match(html, /const INITIAL = /);
  assert.equal(html.includes('"$&"'), true);
  assert.equal(html.includes('"$`-$\'"'), true);
});

test('状态页保留单文件资源与 INITIAL 脚本，不做完整 SSR', () => {
  const html = renderStatusPage({ ok: true, service: { name: 'demo' } });
  assert.match(html, /const INITIAL = /);
  assert.match(html, /render\(INITIAL\)/);
  assert.equal(/<script[^>]+src=/.test(html), false);
  assert.equal(/<(link|img)\b/.test(html), false);
  assert.equal(html.includes('<h1>demo'), false, '报告字段应由脚本填充');
});
