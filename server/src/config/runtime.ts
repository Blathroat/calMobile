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
 *   （它们会暴露迁移清单、各表行数与接口清单，失败时还带 pg 的错误原文）；
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
  };
}

const resolved = resolveRuntime(process.argv, process.env);

export const nodeEnv = resolved.nodeEnv;
export const isProduction = resolved.isProduction;
export const statusPageEnabled = resolved.statusPageEnabled;
export const trustProxy = resolved.trustProxy;
export const startedBy = resolved.startedBy;
