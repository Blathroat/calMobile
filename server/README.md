# CalMobile 后端服务

`server/` 是与 Android 客户端并列的 Node.js 服务。当前有两套并存：

| 目录 | 状态 | 说明 |
| --- | --- | --- |
| `src/demo-server.js` + `src/demo-api.js` + `src/demo-data.js` | **当前使用** | 零依赖（只用 Node 内置 `http`），内存示例数据，给前端一个可跑通的 HTTP 后端 |
| `src/index.js` + `src/routes/` + `src/config/` | 待重构 | Express + PostgreSQL + JWT 的早期骨架，尚未被客户端接入；真实后端将按 `js/core/api.js` 的接口形状重写 |

前端只认 `app/src/main/assets/web/js/core/api.js` 里的接口形状（见根目录 README「前后端边界」），换后端不影响页面。

## 演示后端（现在跑这个）

不需要装任何依赖，也不需要数据库：

```bash
node server/src/demo-server.js      # 或 cd server && npm run demo
```

默认监听 `4000`（`DEMO_PORT` 可改），连通性检查 `GET /ping`。数据在 `src/demo-data.js`，进程重启即回到初始状态。

### 让 Android 端连上

页面运行在 `https://appassets.androidplatform.net` 这个 HTTPS 上下文，而演示后端是明文 HTTP，因此需要两步（都已配好，换机器时照做即可）：

```bash
# 1. 端口转发：真机与模拟器都适用；模拟器也可以改用 10.0.2.2
adb reverse tcp:4000 tcp:4000

# 2. 允许混合内容：WebShellActivity 已设 MIXED_CONTENT_ALWAYS_ALLOW
#    正式后端改 HTTPS 后应改回 MIXED_CONTENT_NEVER_ALLOW，并去掉 manifest 的
#    usesCleartextTraffic 与 INTERNET 权限说明
```

接口路径就是 `js/core/api.js` 里的动作名：`POST /ping`、`POST /bootstrap`、`POST /auth.login`、`POST /exhibitions.month` …… 请求体 JSON，响应直接是页面渲染用的结构。

### 契约测试

`test/demo-api.test.js` 把每个接口调一遍，断言**页面真正用到的字段都在**（例如展会必须带 `qrEnabled`、报名必须带 `checkInCode`），并起一个真实 HTTP 实例校验 404 行为。前后端字段漂移会在这里失败，而不是在页面上静默渲染成空。

```bash
npm run test:contract        # 或 node --test server/test/demo-api.test.js
```

## 早期 Express 骨架（待重构）

`src/index.js`、`src/routes/`、`src/config/` 是与上面并列的 Express + PostgreSQL 实现，提供 JWT 认证与 SQL 版的展会/报名/用户接口。它目前**没有被客户端使用**，作为真实后端的字段与权限参考保留；重构时按其路由设计与 `api.js` 的接口形状对齐。

- 技术栈：Node.js 18+、Express 4、PostgreSQL、JWT、bcryptjs、express-validator。
- `src/middleware/auth.js`：JWT 认证与角色授权。
- `.env.example`：本地配置模板，真实 `.env` 不得提交。

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

### 环境变量

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `DEMO_PORT` | 演示后端端口 | `4000` |
| `DB_HOST`/`DB_PORT` | PostgreSQL 地址和端口 | `localhost` / `5432` |
| `DB_NAME`/`DB_USER`/`DB_PASSWORD` | 数据库凭据 | 仅本地配置 |
| `JWT_SECRET` | 访问令牌密钥 | 至少 32 个随机字符 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥 | 至少 32 个随机字符 |
| `JWT_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN` | 令牌有效期 | `15m` / `7d` |
| `CORS_ORIGIN` | 允许的来源 | `http://localhost:3000` |

### API 目录（Express 骨架）

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

### 数据库与安全

迁移脚本创建 `users`、`exhibitions`、`registrations`、`notifications` 和 `calendar_events` 表；`db:seed` 使用 bcrypt 生成演示密码哈希。生产环境必须更换 JWT 密钥、限制 CORS 来源、使用 TLS，并通过日志系统保护敏感信息。不要把密码、令牌、数据库转储或包含个人信息的日志提交到 Git。

### 验证与部署

```bash
npm test -- --runInBand
npm run lint
```

可以使用 Docker 或 PM2 部署，但镜像和进程管理配置应从环境变量读取密钥。修改路由、数据库字段或认证规则后，同时更新根目录 `README.md` 的架构与路线图，并补充对应测试。
