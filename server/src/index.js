/**
 * 展会排期助手后端服务器
 *
 * 与客户端的约定见 server/README.md：
 * - 读取类接口直接返回数据本身（数组或对象）；
 * - 写入类接口返回应用层信封 `{ ok, error, ... }`，业务失败也是 200，页面按 `.ok` 判断；
 * - 认证 / 授权 / 服务器错误用 4xx / 5xx + `{ error }`，前端会当作异常处理。
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('./config/pool');
const { ApiError } = require('./domain/errors');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志：LOG_LEVEL=quiet 可关掉，测试与联调时更清爽。
if (LOG_LEVEL !== 'quiet') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

// ── 路由 ────────────────────────────────────────────────────────
// 路径与前端 `js/core/api.js` 的 api 域一一对应（见 README「前后端边界」）。
const routes = {
  '': require('./routes/bootstrap'),
  auth: require('./routes/auth'),
  profile: require('./routes/profile'),
  exhibitions: require('./routes/exhibitions'),
  registrations: require('./routes/registrations'),
  review: require('./routes/review'),
  checkin: require('./routes/checkin'),
  users: require('./routes/users'),
  search: require('./routes/search'),
  settings: require('./routes/settings'),
};

for (const [prefix, router] of Object.entries(routes)) {
  app.use(`/api/v1${prefix ? `/${prefix}` : ''}`, router);
}

/** 连通性检查：前端启动时探一次，失败就退回原生桥接。 */
app.get(['/ping', '/api/v1/ping'], (req, res) => {
  res.json({ ok: true, service: 'calmobile-server', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// 404：路径不存在（不是「资源不存在」，那种情况由各路由给 404 + error）
app.use((req, res) => {
  res.status(404).json({ error: `路径 ${req.originalUrl} 不存在` });
});

// 统一错误处理：ApiError 用自带状态码，其余按 500，且不把堆栈发给客户端。
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err instanceof ApiError ? err.status : 500;
  if (status >= 500) {
    console.error('服务器错误：', err);
  }
  res.status(status).json({
    error: err.message || '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
});

async function start() {
  try {
    const client = await pool.connect();
    client.release();
    console.log('数据库连接成功');
    return app.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
      console.log(`连通性检查：http://localhost:${PORT}/ping`);
      console.log(`健康检查：http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('服务器启动失败：', error.message);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`收到 ${signal} 信号，正在关闭服务器...`);
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  start();
}

module.exports = { app, start, routes };
