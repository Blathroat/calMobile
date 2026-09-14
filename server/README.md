# CalMobile 后端服务

`server/` 是与 Android 客户端并列的 Node.js 服务，提供用户认证、展会、报名和用户管理 API。客户端当前仍以 SQLite/内存演示数据运行，接入该服务前请先完成接口适配。

## 技术栈与目录

- Node.js 18+、Express 4、PostgreSQL、JWT、bcryptjs、express-validator。
- `src/index.js`：应用入口、路由挂载、健康检查和错误处理。
- `src/routes/`：`auth.js`、`users.js`、`exhibitions.js`、`registrations.js`。
- `src/middleware/auth.js`：JWT 认证与角色授权。
- `src/config/`：数据库连接、认证配置和迁移/种子脚本。
- `.env.example`：本地配置模板，真实 `.env` 不得提交。

## 本地启动

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env，至少设置 PostgreSQL 连接信息和两个随机 JWT 密钥
psql -U postgres -c "CREATE DATABASE calmobile_dev;"
npm run db:migrate
npm run db:seed       # 可选：插入演示用户、展会和报名
npm run dev           # nodemon 开发模式
```

生产运行使用 `npm start`。默认地址为 `http://localhost:3000`；`GET /health` 返回健康状态，`GET /api` 返回接口目录。

## 环境变量

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `DB_HOST`/`DB_PORT` | PostgreSQL 地址和端口 | `localhost` / `5432` |
| `DB_NAME`/`DB_USER`/`DB_PASSWORD` | 数据库凭据 | 仅本地配置 |
| `JWT_SECRET` | 访问令牌密钥 | 至少 32 个随机字符 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥 | 至少 32 个随机字符 |
| `JWT_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN` | 令牌有效期 | `15m` / `7d` |
| `CORS_ORIGIN` | 允许的来源 | `http://localhost:3000` |

## API 目录

基础路径为 `/api/v1`。除公开读取和认证接口外，请在请求头携带 `Authorization: Bearer <accessToken>`。

| 资源 | 方法与路径 | 权限 |
| --- | --- | --- |
| 认证 | `POST /auth/login`、`/auth/register`、`/auth/refresh`、`/auth/logout` | 登录/注册无需令牌 |
| 用户 | `GET /users`、`GET /users/:id`、`PUT /users/:id`、`DELETE /users/:id`、`PUT /users/:id/status` | 管理员或本人 |
| 展会 | `GET /exhibitions`、`GET /exhibitions/:id`、`GET /exhibitions/search` | 读取可匿名 |
| 展会 | `POST /exhibitions`、`PUT /exhibitions/:id`、`DELETE /exhibitions/:id`、`PUT /exhibitions/:id/status` | 展商本人或管理员 |
| 报名 | `GET /registrations`、`GET /registrations/:id`、`POST /registrations`、`PUT /registrations/:id`、`DELETE /registrations/:id` | 登录用户；展商仅管理自己的展会 |

展会列表支持 `month`、`year`、`status`、`category`、`search` 查询参数。创建/更新展会至少需要 `title`、`venue`、`day`、`month`、`year`、`time`，可附带 `description`、`category` 与 `openForRegistration`。报名状态使用 `pending`、`approved`、`rejected`、`cancelled`；错误响应统一为：

```json
{
  "error": "错误类型",
  "message": "错误描述"
}
```

## 数据库与安全

迁移脚本创建 `users`、`exhibitions`、`registrations`、`notifications` 和 `calendar_events` 表；`db:seed` 使用 bcrypt 生成演示密码哈希。生产环境必须更换 JWT 密钥、限制 CORS 来源、使用 TLS，并通过日志系统保护敏感信息。不要把密码、令牌、数据库转储或包含个人信息的日志提交到 Git。

## 验证与部署

```bash
npm test -- --runInBand
npm run lint
```

可以使用 Docker 或 PM2 部署，但镜像和进程管理配置应从环境变量读取密钥。修改路由、数据库字段或认证规则后，同时更新根目录 `README.md` 的架构与路线图，并补充对应测试。
