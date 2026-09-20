/**
 * 认证接口的内存滑动窗口限流。
 *
 * 登录 / 注册此前没有任何限速，bcrypt 只拖慢单次猜测，挡不住脚本化撞库。
 * 不引入 express-rate-limit 依赖（保持依赖收敛），单进程内存窗口足够兜住
 * 当前「应用唯一客户端 + 本机部署」的形态；将来多实例部署时再换共享存储。
 */

const { ApiError } = require('../domain/errors');

const buckets = new Map();

/** 上次清理时间：避免每个请求都全表扫一遍。 */
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < 60 * 1000) {
    return;
  }
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((at) => now - at < 15 * 60 * 1000);
    if (fresh.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, fresh);
    }
  }
}

/**
 * 固定窗口内最多 max 次，超出给 429。
 * key 按「IP + 用户名」分桶：只按 IP 会把同一 NAT 后的用户一起误伤，
 * 只按用户名又挡不住对一批账号的轮询爆破，两个维度相与才够窄。
 */
function rateLimit({ windowMs, max, message }) {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const identity = String(req.body?.username || req.body?.email || '').toLowerCase();
    const key = `${req.path}|${req.ip || ''}|${identity}`;
    const hits = (buckets.get(key) || []).filter((at) => now - at < windowMs);
    if (hits.length >= max) {
      next(new ApiError(429, message));
      return;
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}

/** 测试用：清空全部计数，避免用例之间互相污染。 */
function resetRateLimits() {
  buckets.clear();
  lastSweep = 0;
}

module.exports = { rateLimit, resetRateLimits };
