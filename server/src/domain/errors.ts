/**
 * 业务错误。
 *
 * 路由里直接 `throw new ApiError(403, '无权执行此操作')`，由 index.js 的错误中间件
 * 统一序列化成 `{ error: '…' }`；前端 api.js 把 4xx + error 当作**业务失败**就地提示，
 * 把 5xx（含数据库不可用的 503）当作传输失败抛出，由页面显示原因——数据只在后端，
 * 没有第二条路径可以退回。
 */

/**
 * 失败响应的稳定错误码与占位值。
 *
 * `code` 是给前端查文案表用的点分码（`server.<code>`），`params` 是文案里 `{名字}` 的值。
 * 中文 `message` 照旧下发：它是兜底，前端遇到不认识的码就原样显示。
 */
export interface ErrorDetail {
  code: string;
  params?: Record<string, string | number>;
}

/** `ErrorDetail` → 响应体里的可选字段（没有码时是空对象，形状与改造前逐字一致）。 */
export function errorDetailFields(detail?: ErrorDetail): {
  errorCode?: string;
  errorParams?: Record<string, string | number>;
} {
  if (!detail) return {};
  return detail.params ? { errorCode: detail.code, errorParams: detail.params } : { errorCode: detail.code };
}

export class ApiError extends Error {
  status: number;

  /**
   * 是否按「写操作信封」收尾（HTTP 200 + `{ ok:false, error }`）。
   *
   * 默认 true。请求体解析失败之类的**HTTP 形状错误**传 false，让它保留 4xx 状态码
   * ——那类错误不是业务规则失败，回 200 会把「请求发错了」伪装成「规则不允许」。
   */
  readonly envelope: boolean;

  /** 稳定错误码；没有时响应里不带这个字段。 */
  readonly errorCode?: string;

  /** 文案里的 `{名字}` 占位值。 */
  readonly errorParams?: Record<string, string | number>;

  constructor(status: number, message: string, envelope = true, detail?: ErrorDetail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
    this.errorCode = detail?.code;
    this.errorParams = detail?.params;
  }

  /**
   * 失败详情的原样形状。
   *
   * 与 `CodeRejected.errorDetail` 同名：路由透传时不用先分辨错误类型，
   * `failureResponse(c, error.message, error.errorDetail)` 对两者都成立。
   */
  get errorDetail(): ErrorDetail | undefined {
    return this.errorCode ? { code: this.errorCode, params: this.errorParams } : undefined;
  }

  /** 响应体里的可选错误码字段；没有码时是空对象。 */
  detailFields(): { errorCode?: string; errorParams?: Record<string, string | number> } {
    return errorDetailFields(this.errorCode ? { code: this.errorCode, params: this.errorParams } : undefined);
  }
}

export const badRequest = (message: string, detail?: ErrorDetail) => new ApiError(400, message, true, detail);
export const unauthorized = (message = '请先登录', detail?: ErrorDetail) => new ApiError(401, message, true, detail);
export const forbidden = (message = '无权执行此操作', detail?: ErrorDetail) => new ApiError(403, message, true, detail);
export const notFound = (message = '内容不存在或已删除', detail?: ErrorDetail) =>
  new ApiError(404, message, true, detail);
export const conflict = (message = '操作与当前状态冲突', detail?: ErrorDetail) =>
  new ApiError(409, message, true, detail);
export const serviceUnavailable = (message = '数据库暂时不可用，请稍后重试', detail?: ErrorDetail) =>
  new ApiError(503, message, true, detail);

/**
 * 「数据库现在用不了」的错误码。
 *
 * 这类错误**不是**服务器内部错误：库没起、连接被拒、握手超时、管理员关库、
 * 连接数打满、库/密码配错都属于「暂时不可用」，统一给 503，客户端据此知道可以重试；
 * 同时避免把 pg 的错误原文（里面带内网 host:port）当成 500 的 `error` 回给调用方。
 */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01', // connection_exception
  '57P01',
  '57P02',
  '57P03', // 管理员关库 / 崩溃恢复 / 正在启动
  '53300', // too_many_connections
  '3D000', // 库不存在
  '28P01', // 密码不对
]);

/** 判断一个错误是不是「数据库暂时不可用」。 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const record = error as { code?: unknown; message?: unknown };
  if (UNAVAILABLE_CODES.has(String(record.code || ''))) {
    return true;
  }
  const message = String(record.message || '');
  return message.includes('timeout exceeded when trying to connect') || message.includes('Connection terminated');
}

/** 条件成立时抛出，用于把「校验 + 报错」写成一行。 */
export function assert(condition: unknown, error: Error): asserts condition {
  if (!condition) {
    throw error;
  }
}
