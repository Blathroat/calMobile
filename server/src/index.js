/**
 * 展会排期助手后端服务器
 * 主入口文件
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('./config/pool');

// 导入路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const exhibitionRoutes = require('./routes/exhibitions');
const registrationRoutes = require('./routes/registrations');

// 创建 Express 应用
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// 路由
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/exhibitions', exhibitionRoutes);
app.use('/api/v1/registrations', registrationRoutes);

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API 文档端点
app.get('/api', (req, res) => {
  res.json({
    name: '展会排期助手 API',
    version: '1.0.0',
    description: '展会排期助手后端 API 文档',
    endpoints: {
      auth: {
        login: 'POST /api/v1/auth/login',
        register: 'POST /api/v1/auth/register',
        refresh: 'POST /api/v1/auth/refresh',
        logout: 'POST /api/v1/auth/logout'
      },
      users: {
        list: 'GET /api/v1/users',
        get: 'GET /api/v1/users/:id',
        update: 'PUT /api/v1/users/:id',
        delete: 'DELETE /api/v1/users/:id'
      },
      exhibitions: {
        list: 'GET /api/v1/exhibitions',
        get: 'GET /api/v1/exhibitions/:id',
        create: 'POST /api/v1/exhibitions',
        update: 'PUT /api/v1/exhibitions/:id',
        delete: 'DELETE /api/v1/exhibitions/:id',
        search: 'GET /api/v1/exhibitions/search'
      },
      registrations: {
        list: 'GET /api/v1/registrations',
        get: 'GET /api/v1/registrations/:id',
        create: 'POST /api/v1/registrations',
        update: 'PUT /api/v1/registrations/:id',
        delete: 'DELETE /api/v1/registrations/:id'
      }
    }
  });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    error: '未找到',
    message: `路径 ${req.originalUrl} 不存在`
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误：', err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || '内部服务器错误';
  
  res.status(statusCode).json({
    error: '服务器错误',
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 启动服务器
async function start() {
  try {
    // 测试数据库连接
    const client = await pool.connect();
    console.log('数据库连接成功');
    client.release();
    
    // 启动服务器
    app.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
      console.log(`API 文档：http://localhost:${PORT}/api`);
      console.log(`健康检查：http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('服务器启动失败：', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  await pool.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  await pool.close();
  process.exit(0);
});

// 启动服务器
start();

module.exports = app;
