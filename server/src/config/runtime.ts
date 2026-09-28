/**
 * 运行环境判定。
 *
 * **`pnpm start` 自动进生产模式，`pnpm dev` 留在开发模式**：
 * - `start` 脚本传 `--production`（跨平台，不依赖 shell 的 `VAR=x` 写法，也不用引入 cross-env）；
 * - `dev` 走 tsx watch，不带参数，读 `.env` 里的 `NODE_ENV=development`；
 * - 真实环境变量优先于 `.env`（`dotenv` 默认不覆盖已存在的变量），所以
 *   `NODE_ENV=production node src/index.js` 与容器里注入的 `NODE_ENV` 同样有效。
 *
 * **本模块必须在任何读取 `NODE_ENV` 的模块之前加载**：`config/mail.ts` 与
 * `config/database.ts` 都是在 require 的那一刻就把值定下来的，晚一步就白改了。
 * `index.js` 与 `config/migrate.ts` 的第一行导入就是它。
 *
 * 模块里同时给出三件生产环境相关的东西（都可用环境变量覆盖）：
 * - `statusPageEnabled`：生产环境**默认关闭** `/status` 与 `/api/v1/status`
 *   （它们会暴露迁移清单、各表行数与接口清单）；
 * - `trustProxy`：反代后面必须显式打开，否则 `req.ip` 会是代理地址，
 *   按 IP 的验证码限流会退化成「全体用户共用一个 1 小时 20 条」的额度；
 * - `startedBy`：给启动日志用，一眼看出这次是 `pnpm start` 还是 `pnpm dev` 起的。
 */

import dotenv from 'dotenv';

dotenv.config({ quiet: true });

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const TRUTHY = ['true', '1', 'yes', 'on'];
const FALSY = ['false', '0', 'no', 'off'];

export type TrustProxy = false | number | string;

export interface Runtime {
  nodeEnv: string;
  isProduction: boolean;
  statusPageEnabled: boolean;
  trustProxy: TrustProxy;
  startedBy: string;
  /** 对外访问地址（`PUBLIC_BASE_URL`，已去掉尾斜杠）：域名/端口对外暴露的那一个。 */
  publicBaseUrl: string;
  /** 反代已终止 TLS 时，把明文请求跳到 https（`FORCE_HTTPS=1`）。 */
  forceHttps: boolean;
  /** HSTS 的 max-age（秒）；0 表示不下发这个头。默认 180 天。 */
  hstsMaxAge: number;
}

export function bool(value: unknown): boolean {
  return TRUTHY.includes(
    String(value === undefined || value === null ? '' : value)
      .trim()
      .toLowerCase(),
  );
}

/**
 * 解析运行环境（纯函数，用例直接喂 argv 与环境对象）。
 *
 * @param argv 形如 `process.argv`（含 node 与脚本路径，函数自己 slice）。
 * @param env 形如 `process.env`。
 */
export function resolveRuntime(argv: string[] = [], env: EnvLike = {}): Runtime {
  const args = argv.slice(2);
  const wantsProduction = args.includes('--production') || args.includes('--prod');
  const wantsDevelopment = args.includes('--development') || args.includes('--dev');
  if (wantsProduction && wantsDevelopment) {
    throw new Error('不能同时指定 --production 与 --development');
  }

  const declared = String(env.NODE_ENV || '').trim();
  const nodeEnv = wantsProduction ? 'production' : wantsDevelopment ? 'development' : declared || 'development';
  const isProduction = nodeEnv === 'production';

  // 状态页：没显式配就按环境取默认（生产关闭、其它开着）。
  const statusSetting = String(env.ENABLE_STATUS_PAGE || '')
    .trim()
    .toLowerCase();
  const statusPageEnabled = statusSetting === '' ? !isProduction : bool(statusSetting);

  // trust proxy：默认**关闭**。反代后面不开的话，所有请求的 IP 都是代理地址，
  // 按 IP 的限流会误伤全体用户；但反过来在直连场景开启，客户端就能伪造
  // `X-Forwarded-For` 绕过按 IP 的限流 —— 所以必须由部署的人自己声明。
  const trustSetting = String(env.TRUST_PROXY || '')
    .trim()
    .toLowerCase();
  let trustProxy: TrustProxy = false;
  if (trustSetting !== '' && !FALSY.includes(trustSetting)) {
    trustProxy = /^\d+$/.test(trustSetting) ? Number(trustSetting) : trustSetting;
  }

  return {
    nodeEnv,
    isProduction,
    statusPageEnabled,
    trustProxy,
    // pnpm / npm 都会设置这个变量：`start` / `dev` / `test` 之一，用于启动日志与排查。
    startedBy: String(env.npm_lifecycle_event || '').trim(),
    // 对外地址：给状态页与 /ping 显示，也是以后邮件里绝对链接的基址。
    publicBaseUrl: normalizeBaseUrl(env.PUBLIC_BASE_URL),
    // 反代终止 TLS 的部署里打开它：明文请求 308 跳到 https（见 node-middleware 的 requireHttps）。
    // 直连（没有反代）时不要开：那会把所有请求跳到一个并不存在的 https 端口上。
    forceHttps: bool(env.FORCE_HTTPS),
    // HSTS：默认 180 天。填 0 表示不下发（例如域名还没定、或本地用 http 调试）。
    // 只应当在**已确认全站 HTTPS 可用**之后才下发长 max-age，否则浏览器会长期拒绝 http 访问。
    hstsMaxAge: parseHstsMaxAge(env.HSTS_MAX_AGE),
  };
}

/** 对外地址归一化：去空白与尾斜杠，非法值当没配（宁可不显示，也不要显示半截地址）。 */
export function normalizeBaseUrl(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) return '';
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : '';
}

/** HSTS 秒数：缺省 180 天；`0` / `off` / `false` 表示不下发。 */
function parseHstsMaxAge(value: unknown): number {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return 15_552_000;
  if (FALSY.includes(text)) return 0;
  const seconds = Number.parseInt(text, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 15_552_000;
}

const resolved = resolveRuntime(process.argv, process.env);

export const nodeEnv = resolved.nodeEnv;
export const isProduction = resolved.isProduction;
export const statusPageEnabled = resolved.statusPageEnabled;
export const trustProxy = resolved.trustProxy;
export const startedBy = resolved.startedBy;
export const publicBaseUrl = resolved.publicBaseUrl;
export const forceHttps = resolved.forceHttps;
export const hstsMaxAge = resolved.hstsMaxAge;
