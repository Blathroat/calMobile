/**
 * Hono 骨架的行为测试。
 *
 * 覆盖第 11 单的验收项：探针、404、JSON 解析失败、体积超限、数据库不可用仍判 503、
 * 安全响应头、CORS（含预检）、请求日志，以及「还没迁移的路由仍然由 Express 代答」。
 *
 * 一律用 `listen()` 起真服务（不是 `app.request()`）：代答链路要拿到 Node 的
 * `incoming` / `outgoing`，只有真服务器才有。`app.request()` 的场景单独跑了
 * 一条——没有 socket 时中间件也不能炸。
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import type { RequestListener } from 'node:http';
import { serveApp } from '../index.js';
import { createApp, type AppOptions } from './hono-app.js';
import { errorResponse } from '../http/error-response.js';

const ORIGIN = 'https://appassets.androidplatform.net';
const VERSION = '9.9.9';

/**
 * 错误出口：与 `createDelegatedApp` 用同一个 `errorResponse()`。
 *
 * 两条迷你应用都挂它——否则 body-parser 的 400 / 413 会落到 Express 默认的
 * HTML 错误页上，断言就變成在读 HTML 而不是读契约里那两句中文文案。
 */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = errorResponse(err);
  res.status(status).json(body);
};

/** 迷你 Express 应用：只用来验证「代答链路」，不碰数据库。 */
function miniExpress(): RequestListener {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1/echo', (req, res) => {
    res.json({ delegated: true, url: req.originalUrl, body: req.body });
  });
  app.use((req, res) => {
    res.status(404).json({ error: `路径 ${req.originalUrl} 不存在` });
  });
  app.use(errorHandler);
  return app as unknown as RequestListener;
}

/**
 * 抛「数据库不可用」的迷你 Express 应用。
 *
 * 错误出口与 `createDelegatedApp` 用同一个 `errorResponse()`，因此这条链路
 * （Express 抛错 → 错误出口 → 503）与生产同源，只是不碰真数据库。
 */
function failingExpress(): RequestListener {
  const app = express();
  app.use('/api/v1/db', () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  });
  app.use(errorHandler);
  return app as unknown as RequestListener;
}

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
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...headers, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const servers: Array<ReturnType<typeof serveApp>> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

/** 起一个骨架；每个用例各起一个，互不影响，跑完由 afterEach 关掉。 */
async function serve(options: Partial<AppOptions> = {}): Promise<{ port: number; hit: typeof hit }> {
  const deps: AppOptions = {
    expressApp: miniExpress(),
    corsOrigin: ORIGIN,
    logLevel: 'quiet',
    trustProxy: false,
    statusPageEnabled: true,
    serviceVersion: VERSION,
  };
  const app = createApp({ ...deps, ...options });
  const port: number = await new Promise((resolve) => {
    // 注意：起的是这里刚建出来的骨架，不是 index.ts 里那个「真身」
    const server = serveApp(app.fetch, 0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    servers.push(server);
  });
  return { port, hit };
}

test('探针：/ping、/api/v1/ping、/health 的形状与迁移前一致', async () => {
  const server = await serve();
  for (const path of ['/ping', '/api/v1/ping']) {
    const reply = await server.hit(server.port, 'GET', path);
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), { ok: true, service: 'calmobile-server', version: VERSION });
    assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
  }

  const health = await server.hit(server.port, 'GET', '/health');
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body) as { status: string; timestamp: string; uptime: number };
  assert.equal(payload.status, 'ok');
  assert.ok(!Number.isNaN(Date.parse(payload.timestamp)), 'timestamp 要能解析');
  assert.ok(payload.uptime >= 0, 'uptime 不能是负的');
});

test('HEAD 探针：状态码与 content-length 与迁移前一致', async () => {
  // @hono/node-server 对 HEAD 不写 content-length，Express 会写，骨架里补了一层
  const server = await serve();
  const reply = await server.hit(server.port, 'HEAD', '/ping');
  assert.equal(reply.status, 200);
  assert.equal(reply.body, '', 'HEAD 不回正文');
  assert.equal(
    reply.headers['content-length'],
    String(
      Buffer.byteLength(
        JSON.stringify({
          ok: true,
          service: 'calmobile-server',
          version: VERSION,
        }),
      ),
    ),
    'content-length 要等于同等 GET 响应的长度',
  );
});

test('404：路径不存在，且带上查询串', async () => {
  const server = await serve();
  const missing = await server.hit(server.port, 'GET', '/nope?a=1');
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.body), { error: '路径 /nope?a=1 不存在' });

  const plain = await server.hit(server.port, 'GET', '/definitely-not-here');
  assert.equal(plain.status, 404);
  assert.deepEqual(JSON.parse(plain.body), { error: '路径 /definitely-not-here 不存在' });
});

test('体积上限：正文超限给 413 + 固定文案，且不进 Express', async () => {
  const server = await serve();
  // 真发一个超限正文：手动写 content-length 会被 Node 客户端按真实长度覆盖，
  // 因此这里让请求体本身超过 2MB，守卫在进 Express 之前就把它挡掉。
  const big = `{"pad":"${'x'.repeat(2 * 1024 * 1024 + 10)}"}`;
  const reply = await server.hit(server.port, 'POST', '/api/v1/echo', big, { 'content-type': 'application/json' });
  assert.equal(reply.status, 413);
  assert.deepEqual(JSON.parse(reply.body), { error: '请求体超过大小上限' });
  assert.ok(!JSON.parse(reply.body).delegated, '超限请求不该到 Express');
});

test('JSON 解析失败与 body 透传都保持迁移前的形状', async () => {
  const server = await serve();
  // 坏 JSON：Express 的 body-parser 用 400 + 同一句文案
  const bad = await server.hit(server.port, 'POST', '/api/v1/echo', '{oops', { 'content-type': 'application/json' });
  assert.equal(bad.status, 400);
  assert.deepEqual(JSON.parse(bad.body), { error: '请求体不是合法的 JSON' });

  // 正常 JSON：body 原样到达 Express
  const ok = await server.hit(server.port, 'POST', '/api/v1/echo', '{"a":1}', {
    'content-type': 'application/json',
    origin: ORIGIN,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { delegated: true, url: '/api/v1/echo', body: { a: 1 } });
});

test('代答：Express 的 404 与状态码原样透传', async () => {
  const server = await serve();
  const reply = await server.hit(server.port, 'GET', '/api/v1/missing');
  assert.equal(reply.status, 404);
  assert.deepEqual(JSON.parse(reply.body), { error: '路径 /api/v1/missing 不存在' });
});

test('数据库不可用：在代答链路上仍然判 503，不判 500', async () => {
  const server = await serve({ expressApp: failingExpress() });
  const reply = await server.hit(server.port, 'GET', '/api/v1/db');
  assert.equal(reply.status, 503);
  assert.deepEqual(JSON.parse(reply.body), { error: '数据库暂时不可用，请稍后重试' });
});

test('安全响应头：Hono 自己答与 Express 代答的响应都带着', async () => {
  const server = await serve();
  const own = await server.hit(server.port, 'GET', '/ping');
  const delegated = await server.hit(server.port, 'GET', '/api/v1/echo');
  for (const [name, value] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'SAMEORIGIN'],
    ['cross-origin-opener-policy', 'same-origin'],
    ['referrer-policy', 'no-referrer'],
    ['strict-transport-security', 'max-age=15552000; includeSubDomains'],
  ] as const) {
    assert.equal(own.headers[name], value, `/ping 缺少 ${name}`);
    assert.equal(delegated.headers[name], value, `代答响应缺少 ${name}`);
  }
  assert.equal(own.headers['x-powered-by'], undefined, '不广播技术栈');
  assert.equal(delegated.headers['x-powered-by'], undefined, '不广播技术栈');
});

test('CORS：固定来源与预检都保持迁移前的形状', async () => {
  const server = await serve();

  // 固定来源：不论请求带不带 Origin，都回同一个值 + Vary（与 cors 包一致）
  const noOrigin = await server.hit(server.port, 'GET', '/ping');
  assert.equal(noOrigin.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(noOrigin.headers['vary'], 'Origin');

  const withOrigin = await server.hit(server.port, 'GET', '/ping', undefined, { origin: ORIGIN });
  assert.equal(withOrigin.headers['access-control-allow-origin'], ORIGIN);

  const otherOrigin = await server.hit(server.port, 'GET', '/ping', undefined, { origin: 'https://other.example' });
  assert.equal(otherOrigin.headers['access-control-allow-origin'], ORIGIN);

  // 代答响应同样带 CORS 头
  const delegated = await server.hit(server.port, 'GET', '/api/v1/echo', undefined, { origin: ORIGIN });
  assert.equal(delegated.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(delegated.headers['vary'], 'Origin');

  // 预检：204 + 方法表 + 回显客户端请求的头，且不进 Express
  const preflight = await server.hit(server.port, 'OPTIONS', '/api/v1/auth/login', undefined, {
    origin: ORIGIN,
    'access-control-request-method': 'POST',
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET,HEAD,PUT,PATCH,POST,DELETE');
  assert.equal(preflight.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(preflight.body, '');

  const withHeaders = await server.hit(server.port, 'OPTIONS', '/api/v1/auth/login', undefined, {
    origin: ORIGIN,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization,content-type',
  });
  assert.equal(withHeaders.headers['access-control-allow-headers'], 'authorization,content-type');
});

test('CORS_ORIGIN=* 时回通配来源', async () => {
  const server = await serve({ corsOrigin: '*' });
  const reply = await server.hit(server.port, 'GET', '/ping');
  assert.equal(reply.headers['access-control-allow-origin'], '*');
  assert.equal(reply.headers['vary'], undefined);
});

test('请求日志：默认打一行，quiet 关掉', async () => {
  const logged: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
  try {
    const server = await serve({ logLevel: 'info' });
    await server.hit(server.port, 'GET', '/ping');
    await server.hit(server.port, 'POST', '/api/v1/echo', '{}', { 'content-type': 'application/json' });

    assert.equal(logged.length, 2, `应当打两行日志：${JSON.stringify(logged)}`);
    assert.match(logged[0]!, /^127\.0\.0\.1 GET \/ping 200 \d+ms$/);
    assert.match(logged[1]!, /^127\.0\.0\.1 POST \/api\/v1\/echo 200 \d+ms$/, '代答的那行也要记');
  } finally {
    console.log = original;
  }

  const quiet = await serve({ logLevel: 'quiet' });
  assert.equal((await quiet.hit(quiet.port, 'GET', '/ping')).status, 200);
  assert.equal(logged.length, 2, 'quiet 之后不该再打日志');
});

test('状态页开关：生产默认关，两个路径都回同一句话', async () => {
  const server = await serve({ statusPageEnabled: false });
  const message = { error: '状态页在生产环境已关闭（需要时设 ENABLE_STATUS_PAGE=true 再启动）' };
  for (const path of ['/status', '/api/v1/status']) {
    const reply = await server.hit(server.port, 'GET', path);
    assert.equal(reply.status, 404);
    assert.deepEqual(JSON.parse(reply.body), message);
  }
});

test('请求日志：超限与坏 JSON 也各记一行（公共层不挑响应）', async () => {
  const logged: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
  try {
    const server = await serve({ logLevel: 'info' });
    const big = `{"pad":"${'x'.repeat(2 * 1024 * 1024 + 10)}"}`;
    await server.hit(server.port, 'POST', '/api/v1/echo', big, { 'content-type': 'application/json' });
    await server.hit(server.port, 'POST', '/api/v1/echo', '{oops', { 'content-type': 'application/json' });
  } finally {
    console.log = original;
  }
  // 迁移前 express 的体积/解析错误在到达日志器之前就被短路，因此不记；现在公共层
  // 统一记——失败请求反而是最该留痕的那批。
  assert.equal(logged.length, 2, `应当打两行日志：${JSON.stringify(logged)}`);
  assert.match(logged[0]!, /^127\.0\.0\.1 POST \/api\/v1\/echo 413 \d+ms$/);
  assert.match(logged[1]!, /^127\.0\.0\.1 POST \/api\/v1\/echo 400 \d+ms$/);
});

test('代答不会把响应写两次（overrideGlobalObjects: false 这条约束的回归防线）', async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.join(' '));
  };
  try {
    const server = await serve();
    const reply = await server.hit(server.port, 'GET', '/api/v1/echo');
    assert.equal(reply.status, 200, '代答本身要是成功的');
    assert.deepEqual(JSON.parse(reply.body), { delegated: true, url: '/api/v1/echo' });
  } finally {
    console.error = original;
  }
  // 少了 overrideGlobalObjects: false，适配器会在 Express 写完后再 writeHead 一次，
  // 于是每条代答请求都会刷 ERR_HTTP_HEADERS_SENT（客户端照旧拿到先写的那份，
  // 不显眼但很吵——而且真正的写两次迟早会咬到别的地方）。
  const duplicates = errors.filter((line) => /ERR_HTTP_HEADERS_SENT|headers after they are sent/i.test(line));
  assert.deepStrictEqual(duplicates, [], `代答被写了两次：${duplicates.join('; ')}`);
});

test('客户端中途断开：代答链路不应挂住服务', async () => {
  const server = await serve();
  const port = server.port;
  // 发起一个不读响应的请求，随后立刻断开连接
  const aborted = await new Promise<boolean>((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/echo', method: 'GET' }, () => resolve(false));
    req.on('error', () => resolve(true));
    req.end();
    req.destroy();
  });
  // 断开的语义各版本 Node 略有差别，这里只关心「服务还活着」
  void aborted;
  const after = await hit(port, 'GET', '/ping');
  assert.equal(after.status, 200, '断开一次连接之后服务要还能应答');
});

test('代答的 HEAD 请求：content-length 由 Express 给，与迁移前一致', async () => {
  const server = await serve();
  const reply = await server.hit(server.port, 'HEAD', '/api/v1/echo');
  assert.equal(reply.status, 200);
  assert.equal(reply.body, '');
  assert.ok(reply.headers['content-length'], '代答 HEAD 也要带 content-length');
  assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
});

test('没有 socket 的场景（app.request）中间件也不能炸', async () => {
  const app = createApp({
    expressApp: miniExpress(),
    corsOrigin: ORIGIN,
    logLevel: 'quiet',
    trustProxy: false,
    statusPageEnabled: false,
    serviceVersion: VERSION,
  });
  const response = await app.request('/ping');
  assert.equal(response.status, 200);
  // 没有 socket 时，安全头与 CORS 头落到 Response 上，探针仍然完整
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);

  // 代答在没有 socket 时只能走「路径不存在」这条兜底：至少是个诚实的 404
  const missing = await app.request('/api/v1/echo');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
});
