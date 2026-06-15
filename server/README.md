# 展会排期助手后端服务器

## 概述

这是展会排期助手的后端服务器，提供 RESTful API 接口，支持展会管理、用户认证、报名管理等功能。

## 技术栈

- **运行时**: Node.js 18+
- **框架**: Express.js
- **数据库**: PostgreSQL
- **认证**: JWT (JSON Web Tokens)
- **验证**: express-validator
- **密码加密**: bcryptjs

## 项目结构

```
server/
├── src/
│   ├── config/           # 配置文件
│   │   ├── database.js   # 数据库配置
│   │   ├── pool.js       # 数据库连接池
│   │   └── migrate.js    # 数据库迁移脚本
│   ├── middleware/        # 中间件
│   │   └── auth.js       # 认证中间件
│   ├── routes/           # 路由
│   │   ├── auth.js       # 认证路由
│   │   ├── users.js      # 用户路由
│   │   ├── exhibitions.js # 展会路由
│   │   └── registrations.js # 报名路由
│   └── index.js          # 主入口文件
├── docs/                 # 文档
├── .env.example          # 环境变量示例
├── package.json          # 项目配置
└── README.md             # 项目说明
```

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库连接信息：

```env
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=calmobile_dev
DB_USER=postgres
DB_PASSWORD=your_password

# JWT 配置
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_jwt_refresh_secret_here
```

### 3. 创建数据库

```bash
# 使用 PostgreSQL 客户端创建数据库
psql -U postgres -c "CREATE DATABASE calmobile_dev;"
```

### 4. 运行数据库迁移

```bash
npm run db:migrate
```

### 5. 插入示例数据（可选）

```bash
npm run db:seed
```

### 6. 启动服务器

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务器将在 `http://localhost:3000` 启动。

## API 文档

### 基础 URL

```
http://localhost:3000/api/v1
```

### 认证

所有需要认证的接口都需要在请求头中携带 JWT 令牌：

```
Authorization: Bearer <your_access_token>
```

### 接口列表

#### 认证接口

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/auth/login` | 用户登录 | 否 |
| POST | `/auth/register` | 用户注册 | 否 |
| POST | `/auth/refresh` | 刷新令牌 | 否 |
| POST | `/auth/logout` | 用户登出 | 否 |

#### 用户接口

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/users` | 获取用户列表 | 管理员 |
| GET | `/users/:id` | 获取用户信息 | 是 |
| PUT | `/users/:id` | 更新用户信息 | 是 |
| DELETE | `/users/:id` | 删除用户 | 管理员 |
| PUT | `/users/:id/status` | 更新用户状态 | 管理员 |

#### 展会接口

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/exhibitions` | 获取展会列表 | 否 |
| GET | `/exhibitions/search` | 搜索展会 | 否 |
| GET | `/exhibitions/:id` | 获取展会信息 | 否 |
| POST | `/exhibitions` | 创建展会 | 展商/管理员 |
| PUT | `/exhibitions/:id` | 更新展会 | 是 |
| DELETE | `/exhibitions/:id` | 删除展会 | 是 |
| PUT | `/exhibitions/:id/status` | 更新展会状态 | 是 |

#### 报名接口

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/registrations` | 获取报名列表 | 是 |
| GET | `/registrations/:id` | 获取报名信息 | 是 |
| POST | `/registrations` | 创建报名 | 是 |
| PUT | `/registrations/:id` | 更新报名状态 | 是 |
| DELETE | `/registrations/:id` | 删除报名 | 是 |

### 请求/响应示例

#### 用户登录

**请求:**
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "demo",
  "password": "password"
}
```

**响应:**
```json
{
  "data": {
    "user": {
      "id": "usr-1",
      "username": "demo",
      "email": "demo@example.com",
      "nickname": "展会达人",
      "role": "admin",
      "status": "active"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 获取展会列表

**请求:**
```http
GET /api/v1/exhibitions?month=6&year=2026
Authorization: Bearer <access_token>
```

**响应:**
```json
{
  "data": [
    {
      "id": "exh-1",
      "title": "华南智能制造展",
      "venue": "深圳国际会展中心 6 号馆",
      "day": 6,
      "month": 6,
      "year": 2026,
      "time": "09:30-17:00",
      "status": "报名中",
      "open_for_registration": true,
      "description": "聚焦工业机器人、柔性产线和数字化工厂方案",
      "category": "智能制造 / 工业自动化"
    }
  ]
}
```

## 错误处理

所有错误响应都遵循以下格式：

```json
{
  "error": "错误类型",
  "message": "错误描述"
}
```

### 常见错误码

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未认证或令牌无效 |
| 403 | 无权访问 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 500 | 服务器内部错误 |

## 开发指南

### 代码风格

- 使用 ESLint 进行代码检查
- 遵循 JavaScript Standard Style
- 所有注释使用中文

### 测试

```bash
npm test
```

### 部署

#### 使用 Docker

```bash
# 构建镜像
docker build -t calmobile-server .

# 运行容器
docker run -p 3000:3000 --env-file .env calmobile-server
```

#### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 启动服务器
pm2 start src/index.js --name calmobile-server

# 查看日志
pm2 logs calmobile-server

# 重启服务器
pm2 restart calmobile-server
```

## 许可证

本项目为私有项目，未授权公开使用。
