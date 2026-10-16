/**
 * 契约测试的共享设施。
 *
 * 只有**跨文件公用**的部分放在这里：HTTP 小工具、示例数据构造、登录辅助、
 * 内存收件箱读码、身份复核、额度并发夹具，以及测试服务的起停。
 *
 * 文件名不以 `.test.ts` 结尾，所以 vitest 的 contract project（只收
 * `src/test` 目录下后缀为 `.test.ts` 的文件）不会把它当成用例收集。
 *
 * 每个测试文件在自己的进程里跑（vitest `pool: 'forks'`、`fileParallelism: false`），
 * 因此 `startContract()` / `stopContract()` 必须在**每个文件的** beforeAll / afterAll 里各调一次。
 *
 * 契约测试覆盖三件事，由各主题文件分别承担：
 * 1. **契约**：逐接口断言页面真正用到的字段都在；
 * 2. **权限**：访客 / 普通用户 / 展商 / 管理员四类身份的越权访问必须被拦住；
 * 3. **业务规则**：报名窗口、重复报名、自动通过、审核流转、核销状态、隐私开关。
 *
 * 用独立的测试库（默认 `calmobile_test`）。库由 `test/global-setup-contract.ts`
 * 建成的模板克隆而来，每个文件一份干净数据，不会污染开发库。
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { vi } from 'vitest';
import { host, port, user, password, database as databaseName } from '../config/database.js';
import { pool } from '../config/pool.js';
import { contractTemplateName } from './contract-template.js';
import { outbox } from '../services/mailer.js';
import type { StoredMail } from '../services/mailer.js';
import { app, listen } from '../index.js';
import bcrypt from 'bcryptjs';

/** 响应体：逐接口字段差异极大，契约断言直接探属性，故用宽松类型承载。 */
export interface HttpResponse {
  status: number;
  body: any;
  /** 需要断言响应头的用例才看这个字段（公共 request() 一律带上）。 */
  headers?: http.IncomingHttpHeaders;
}

/** `request()` 的可选参数：鉴权令牌、请求体与额外请求头。 */
export interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** 前端 `api.js` 里 `ENDPOINTS` 的一个动作：求值后得到 { method, path }。 */
export interface FrontendEndpoint {
  method: string;
  path: string;
}

/** 前端 `ENDPOINTS` 求值结果：动作名 → (参数) => { method, path }。 */
export type EndpointMap = Record<string, (payload: Record<string, unknown>) => FrontendEndpoint>;

/** 后端实际注册路由表里的一条：[方法, 路径, 匹配用的正则]。 */
export interface DeclaredRoute {
  method: string;
  path: string;
  pattern: RegExp;
}

let server: ReturnType<typeof listen> | undefined;
/** 契约测试单独使用的上传目录，避免清理逻辑删到开发库里的头像。 */
let contractUploadDir = '';
const contractUploadDirPrevious = process.env.UPLOAD_DIR;

/** 前端 `api.js` 导出的 `ENDPOINTS`。在 startContract() 里导入，用例里直接调用。 */
export let frontendEndpointMap!: EndpointMap;

/**
 * 带 id 的完整参数与空参数各算一次。
 * `exhibitions.save` 这类按有没有 id 分派 POST / PUT 的映射，两个分支都要能对上路由。
 */
export const ENDPOINT_SAMPLES: Record<string, unknown>[] = [
  {},
  {
    id: 'sample-id',
    userId: 'sample-id',
    exhibitionId: 'sample-id',
    nickname: 'n',
    query: 'q',
    year: 2026,
    month: 6,
    day: 1,
    status: '待审核',
    code: 'c',
  },
];

/**
 * 起测试服务。
 *
 * 骨架是 Hono + `@hono/node-server`：`listen()` 返回的就是 Node 的 http.Server，
 * 因此随机端口、取端口号、`close()` 的用法与迁移前完全一致。
 */
function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = listen(0, '127.0.0.1', resolve);
  });
}

/** 服务的监听端口（startContract() 起好服务后才能取到；Unix 域套接字不在测试场景内）。 */
export function serverPort(): number {
  const address = server?.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试服务尚未监听在可识别的端口上');
  }
  return address.port;
}

// ── HTTP 小工具 ──────────────────────────────────────────────────

/** 发一次请求；返回 { status, body }，body 已解析成对象（解析失败给原始文本）。 */
export function request(
  method: string,
  path: string,
  { token, body, headers }: RequestOptions = {},
): Promise<HttpResponse> {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: serverPort(),
        // 查询串里有中文（状态筛选、搜索关键词），http 模块要求路径已编码；
        // encodeURI 保留 / ? & =，正好是「路径 + 查询串」需要的粒度。
        path: encodeURI(path),
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let parsed = text;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            // 保持原始文本，便于断言失败时看清返回了什么
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export const get = (path: string, options?: RequestOptions): Promise<HttpResponse> => request('GET', path, options);
export const post = (path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse> =>
  request('POST', path, { ...options, body });
export const put = (path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse> =>
  request('PUT', path, { ...options, body });
export const del = (path: string, options?: RequestOptions): Promise<HttpResponse> => request('DELETE', path, options);

/** 暂停真实写入，等并发请求全部进入锁等待后放行，稳定复现先读后写的竞态。 */
export async function raceWrites(
  table: 'exhibitions' | 'users',
  requests: Array<() => Promise<HttpResponse>>,
): Promise<HttpResponse[]> {
  const blocker = await pool.connect();
  let pending: Promise<HttpResponse[]> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(`LOCK TABLE ${table} IN SHARE MODE`);
    pending = Promise.all(requests.map((run) => run()));
    await vi.waitFor(
      async () => {
        const waiting = await pool.query<{ total: number }>(
          `SELECT count(*)::int AS total FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        assert.ok(Number(waiting.rows[0]?.total) >= requests.length, '并发请求尚未全部进入锁等待');
      },
      { timeout: 5000, interval: 10 },
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    // 失败时也收完请求，避免未完成写入污染下一条用例。
    if (pending) await pending;
  }
  return pending!;
}

/** 示例展会的日期是相对今天生成的，因此期望值也要按「今天」算出来。 */
export function isoDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 登录并返回 { token, refreshToken, user }。 */
export async function login(username: string, password = 'password'): Promise<any> {
  const response = await post('/api/v1/auth/login', { username, password });
  assert.strictEqual(response.status, 200, `登录 ${username} 失败：${JSON.stringify(response.body)}`);
  assert.strictEqual(response.body.ok, true, `登录 ${username} 返回失败：${JSON.stringify(response.body)}`);
  return response.body;
}

/**
 * 取最近一封发给该邮箱的验证码。
 *
 * **明文码只存在于邮件正文里**（库里只有 sha256 哈希），所以用例从内存收件箱的正文里把它读出来 ——
 * 走的正是用户实际收到的那条路径，而不是给测试单开的后门（后端没有、也不该有「读出明文码」的接口）。
 */
export function codeFromInbox(email: string): { code: string; mail: StoredMail } {
  const target = String(email).trim().toLowerCase();
  const mail = outbox()
    .filter((item) => item.to === target)
    .pop();
  assert.ok(mail, `内存收件箱里没有发给 ${target} 的邮件`);
  const match = /验证码：(\d{6})/.exec(mail.text);
  assert.ok(match, `邮件正文里没有 6 位验证码：\n${mail.text}`);
  return { code: match[1]!, mail };
}

/** 通过真实邮件或 TOTP 领取限定用途的一次性身份复核票。 */
export async function identityTicket(
  token: string,
  email: string,
  scope: 'password' | 'email' | 'totp' | 'factor',
  options: { method?: 'email' | 'totp'; code?: string } = {},
): Promise<string> {
  const method = options.method || 'email';
  let code = options.code || '';
  if (method === 'email') {
    // 测试不等待生产环境 60 秒重发窗口；验证码本身仍走实际签发、邮件与消费链路。
    await pool.query("DELETE FROM email_codes WHERE lower(email) = lower($1) AND purpose = 'security'", [email]);
    const sent = await post('/api/v1/profile/security/email-code', undefined, { token });
    assert.strictEqual(sent.body.ok, true, `身份复核码发送失败：${JSON.stringify(sent.body)}`);
    code = codeFromInbox(email).code;
  }
  const verified = await post('/api/v1/profile/security/verify', { method, code, scope }, { token });
  assert.strictEqual(verified.body.ok, true, `身份复核失败：${JSON.stringify(verified.body)}`);
  assert.ok(verified.body.stepUpToken, '应发出短时身份复核票');
  return verified.body.stepUpToken;
}

/** 一个必然与真实码不同的 6 位码（用来测错码分支，避免极小概率撞上真码）。 */
export function otherCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

/**
 * 契约环境里由 `test/setup-contract.ts` 的 `vi.stubEnv` 注入的 CORS_ORIGIN。
 * 与业务无关，只看骨架的 CORS 行为；写死字面量，不读 process.env。
 */
export const CORS_ORIGIN_FOR_TESTS = 'https://appassets.androidplatform.net';

export const tokens: Record<string, any> = {};

/**
 * 建一个「已验证邮箱」的临时账号。
 *
 * 两步验证与改邮箱的用例需要一个干净的账号：示例账号的密码被改掉会影响后面的用例，
 * 邮箱也不能随便动（`demo@example.com` 之类在别处当已知数据用）。
 */
export async function createVerifiedAccount(
  id: string,
  username: string,
  email: string,
  password = 'password',
): Promise<void> {
  await pool.query(
    `
        INSERT INTO users (id, username, password_hash, email, nickname, role, email_verified, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, 'user', true, now())
        ON CONFLICT (id) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                email = EXCLUDED.email,
                email_verified = true,
                two_factor_enabled = false
    `,
    [id, username, await bcrypt.hash(password, 4), email, username],
  );
}

/** 把 `/exhibitions/:id/status` 这样的声明转成匹配用的正则。 */
function routePattern(full: string): RegExp {
  const segments = full
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${segments.join('/')}$`);
}

/** 后端实际注册的 Hono 路由表：[方法, 匹配用的正则]。 */
export function backendRoutes(): DeclaredRoute[] {
  const unique = new Map<string, DeclaredRoute>();
  for (const route of app.routes) {
    if (
      route.method === 'ALL' ||
      !route.path.startsWith('/api/v1/') ||
      route.path === '/api/v1/ping' ||
      route.path === '/api/v1/status'
    ) {
      continue;
    }
    unique.set(`${route.method} ${route.path}`, {
      method: route.method,
      path: route.path,
      pattern: routePattern(route.path),
    });
  }
  return [...unique.values()];
}

/**
 * 起一套契约测试环境：从模板库克隆出测试库 → 起服务 → 加载
 * `web/api-endpoints.mjs` → 登录 demo / exhibitor / user 三个示例账号。
 *
 * 每个测试文件的 beforeAll 都要调一次：文件之间不共享进程内状态。
 */
export async function startContract(): Promise<void> {
  contractUploadDir = await mkdtemp(path.join(tmpdir(), 'calmobile-contract-uploads-'));
  process.env.UPLOAD_DIR = contractUploadDir;
  // 模板库已迁移并 seed 过（见 test/global-setup-contract.ts），克隆即可拿到干净数据。
  const admin = new Client({
    host,
    port: Number(port),
    user,
    password,
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE "${contractTemplateName()}"`);
  await admin.end();

  await startServer();

  const apiModule = await import(new URL('../../../web/api-endpoints.mjs', import.meta.url).href);
  frontendEndpointMap = apiModule.ENDPOINTS as EndpointMap;

  tokens.admin = await login('demo');
  tokens.exhibitor = await login('exhibitor');
  tokens.user = await login('user');
}

/** 收尾：关服务 → pool.end() → 还原 UPLOAD_DIR → 删临时上传目录。 */
export async function stopContract(): Promise<void> {
  if (server) {
    await new Promise((resolve) => server!.close(resolve));
  }
  await pool.end();
  if (contractUploadDirPrevious === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = contractUploadDirPrevious;
  if (contractUploadDir) await rm(contractUploadDir, { recursive: true, force: true });
}
