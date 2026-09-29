/** Hono 骨架与公共层回归测试。 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { serveApp } from '../index.js';
import { createApp, type AppOptions } from './hono-app.js';

const ORIGIN = 'https://appassets.androidplatform.net';
const VERSION = '9.9.9';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function hit(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }) },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: text }));
      },
    );
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

const servers: Array<ReturnType<typeof serveApp>> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serve(overrides: Partial<AppOptions> = {}): Promise<{ port: number }> {
  const options: AppOptions = {
    corsOrigin: ORIGIN,
    logLevel: 'quiet',
    trustProxy: false,
    statusPageEnabled: false,
    serviceVersion: VERSION,
    ...overrides,
  };
  const app = createApp(options);
  const port = await new Promise<number>((resolve) => {
    const server = serveApp(app.fetch, 0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    servers.push(server);
  });
  return { port };
}

test('探针与健康检查保持稳定响应', async () => {
  const server = await serve();
  for (const path of ['/ping', '/api/v1/ping']) {
    const response = await hit(server.port, 'GET', path);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true, service: 'calmobile-server', version: VERSION });
  }
  const health = await hit(server.port, 'GET', '/health');
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body) as { status: string; timestamp: string; uptime: number };
  assert.equal(payload.status, 'ok');
  assert.ok(!Number.isNaN(Date.parse(payload.timestamp)));
  assert.ok(payload.uptime >= 0);
});

test('HEAD 探针补齐 content-length', async () => {
  const server = await serve();
  const response = await hit(server.port, 'HEAD', '/ping');
  assert.equal(response.status, 200);
  assert.equal(response.body, '');
  assert.equal(
    response.headers['content-length'],
    String(Buffer.byteLength(JSON.stringify({ ok: true, service: 'calmobile-server', version: VERSION }))),
  );
});

test('未知路径返回统一 JSON 404', async () => {
  const server = await serve();
  const response = await hit(server.port, 'GET', '/nope?a=1');
  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: '路径 /nope?a=1 不存在' });
});

test('公共 JSON 体积守卫拒绝超限正文', async () => {
  const server = await serve();
  const body = `{"pad":"${'x'.repeat(2 * 1024 * 1024 + 10)}"}`;
  const response = await hit(server.port, 'POST', '/api/v1/auth/guest', body, { 'content-type': 'application/json' });
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(response.body), { error: '请求体超过大小上限' });
});

test('CORS 与预检由 Hono 公共层处理', async () => {
  const server = await serve();
  const response = await hit(server.port, 'GET', '/ping', undefined, { origin: ORIGIN });
  assert.equal(response.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(response.headers['vary'], 'Origin');
  const preflight = await hit(server.port, 'OPTIONS', '/api/v1/auth/login', undefined, {
    origin: ORIGIN,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization,content-type',
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.body, '');
  assert.equal(preflight.headers['access-control-allow-headers'], 'authorization,content-type');
});

test('生产关闭状态页时两个路径都返回 404', async () => {
  const server = await serve({ statusPageEnabled: false });
  const message = { error: '状态页在生产环境已关闭（需要时设 ENABLE_STATUS_PAGE=true 再启动）' };
  for (const path of ['/status', '/api/v1/status']) {
    const response = await hit(server.port, 'GET', path);
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), message);
  }
});

test('HSTS 默认下发，HSTS_MAX_AGE=0 时不下发', async () => {
  const withHsts = await serve();
  const normal = await hit(withHsts.port, 'GET', '/ping');
  assert.match(String(normal.headers['strict-transport-security']), /max-age=\d+/);

  const withoutHsts = await serve({ hstsMaxAge: 0 });
  const stripped = await hit(withoutHsts.port, 'GET', '/ping');
  assert.equal(stripped.headers['strict-transport-security'], undefined);
});

test('FORCE_HTTPS 把明文请求 308 跳到 https，已是 https 的照常处理', async () => {
  const server = await serve({ forceHttps: true });

  const plain = await hit(server.port, 'GET', '/ping', undefined, {
    'x-forwarded-proto': 'http',
    host: 'app.example.com',
  });
  assert.equal(plain.status, 308);
  assert.equal(plain.headers.location, 'http://app.example.com/ping'.replace('http://', 'https://'));

  // 反代已经终止 TLS：X-Forwarded-Proto 是 https，正常响应
  const secure = await hit(server.port, 'GET', '/ping', undefined, { 'x-forwarded-proto': 'https' });
  assert.equal(secure.status, 200);

  // 直连（没有这个头）时不跳转：误开这一项也不会把请求送到不存在的 https 端口
  const direct = await hit(server.port, 'GET', '/ping');
  assert.equal(direct.status, 200);
});

test('Hono 认证路由直接处理请求', async () => {
  const server = await serve();
  const response = await hit(server.port, 'POST', '/api/v1/auth/guest');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as { ok: boolean; error: string; user: { guest: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.error, '');
  assert.equal(body.user.guest, true);
});
