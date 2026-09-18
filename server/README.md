# CalMobile 后端服务

`server/` 是与 Android 客户端并列的 Node.js 服务：**Express + PostgreSQL**，提供客户端全部数据接口。前端只认 `app/src/main/assets/web/js/core/api.js` 里的动作名，HTTP 形状由该文件的 `ENDPOINTS` 表翻译，因此后端换实现不影响页面。

| 目录 | 说明 |
| --- | --- |
| `src/index.js` | 入口：中间件、路由挂载、统一错误处理 |
| `src/routes/` | 按资源分的路由（认证、资料、展会、报名、审核、核销、用户、搜索、设置、启动数据） |
| `src/domain/` | 业务层：状态词汇、SQL 片段、响应映射、权限、校验、设置、会话 |
| `src/config/` | 连接池、迁移与示例数据、JWT 配置 |
| `src/middleware/auth.js` | JWT 认证中间件 |
| `src/demo-server.js` + `src/demo-api.js` + `src/demo-data.js` | 旧的零依赖内存后端，已被上面这套取代；保留作为「不装数据库也能跑通前端」的备用演示（`npm run demo`，端口 4000） |

## 快速开始

```bash
cd server
npm install
cp .env.example .env          # 本地数据库与两个 JWT 密钥

# 起数据库（默认 Docker；脚本幂等，已起过就直接返回状态）
pwsh -File ..\scripts\db.ps1 start
# 等价的手工命令：
#   docker run -d --name calmobile-pg \
#     -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=calmobile_dev \
#     -e TZ=Asia/Shanghai -e PGTZ=Asia/Shanghai \
#     -p 5432:5432 -v calmobile-pgdata:/var/lib/postgresql/data \
#     --restart unless-stopped postgres:16-alpine -c timezone=Asia/Shanghai

npm run db:migrate            # 可反复执行，只跑没跑过的迁移
npm run db:seed               # 示例账号与展会（可反复执行）
npm run dev                   # nodemon，默认 http://127.0.0.1:3000
```

示例账号：`demo`（管理员）、`exhibitor`（展商）、`user`（普通用户），密码都是 `password`。

### 数据库：Docker 为主，WSL 为备选

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| Docker（默认） | `pwsh -File scripts\db.ps1 start` | 容器 `calmobile-pg`，数据在命名卷 `calmobile-pgdata` 里，`--restart unless-stopped` 开机自起；`postgres:16-alpine` 固定版本 |
| WSL | `pwsh -File scripts\db.ps1 start -Provider wsl` | 发行版里 `apt install postgresql` 装的那份；没有 Docker 时用 |

两条路都监听 `127.0.0.1:5432`，所以 `server/.env` 不用改，**同一时间只跑一个**（换路之前先 `db.ps1 stop`）。`status` / `stop` / `psql` 同样支持 `-Provider`。

**容器必须设时区**：镜像默认 UTC，而数据库的 `CURRENT_DATE` 决定报名窗口与日历落点。不设 `TZ`/`-c timezone=` 的话，本机 00:00–08:00 这段时间里数据库的「今天」还停在昨天，演示会出现莫名差一天。脚本里已经带上了 `Asia/Shanghai`。

### 让 Android 端连上

页面运行在 `https://appassets.androidplatform.net` 这个 HTTPS 上下文，而后端是明文 HTTP：

```bash
# 1. 端口转发：真机与模拟器都适用
adb reverse tcp:3000 tcp:3000

# 2. 允许混合内容：WebShellActivity 已设 MIXED_CONTENT_ALWAYS_ALLOW
#    后端改 HTTPS 后应改回 MIXED_CONTENT_NEVER_ALLOW，并去掉 manifest 的
#    usesCleartextTraffic 与 INTERNET 权限说明
```

改了 `src/*.js` 之后**必须重启进程**：Node 会缓存已加载的模块，旧进程会继续按改之前的逻辑应答。

## 响应约定

前后端只有两套约定，页面与 `api.js` 都按它判断：

| 情况 | HTTP | 响应体 | 前端行为 |
| --- | --- | --- | --- |
| 读取成功 | 200 | 数据本身（数组或对象） | 直接渲染 |
| 写入成功 | 200 | `{ ok:true, error:'', ...附加字段 }` | 按附加字段就地更新界面 |
| **校验 / 业务规则失败**（参数不合法、状态不允许、重复报名、数量超限） | 200 | `{ ok:false, error:'中文原因' }` | `if (!result.ok)` 就地提示；这是与原生桥接一致的写法，因此页面不用改 |
| 未登录 / 令牌失效 | 401 | `{ error }` | `api.js` 会先用刷新令牌换一次，失败则抛错由页面提示 |
| 无权访问 / 找不到目标 | 403 / 404 | `{ error }` | 抛错提示（不伪装成 200 成功） |
| 服务器错误 | 5xx | `{ error }` | 抛错；`api.js` 认为这是传输层问题，可以退回原生桥接 |

也就是说 **HTTP 状态码表达认证与授权语义，业务规则的失败一律 200 + `ok:false`**。这样做的原因：客户端同时有「HTTP 后端」和「原生桥接」两条实现，页面用同一套 `{ ok, error }` 判断才能两边通用。写路由统一用 `domain/respond.js` 的 `mutate()` 收尾，它只把 400 / 409 收成信封，401 / 403 / 404 继续上抛。

## 接口清单

基础路径 `/api/v1`。括号里是对应的前端动作名。

### 启动与认证

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /bootstrap` | `bootstrap` | 可匿名。一次下发 `user / theme / ui / capabilities / categories / review / media / announcement / brand / limits / server / calendar`（含 `calendar.landing` 落点月份） |
| `POST /auth/login` | `auth.login` | 账号密码换 `token` + `refreshToken`，并更新最近登录时间 |
| `POST /auth/register` | `auth.register` | 自助注册固定为普通用户；用户名 / 密码长度取服务器设置 |
| `POST /auth/guest` | `auth.guest` | 只返回访客态，不发令牌 |
| `POST /auth/logout` | `auth.logout` | 撤销该刷新令牌 |
| `POST /auth/refresh` | — | 刷新令牌换新令牌（轮换：旧的立即作废） |

### 资料与偏好

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /profile` | `profile.get` | 登录 |
| `PUT /profile` | `profile.save` | 登录。只写出现过的字段（个人页保存资料不会顺带改隐私开关） |
| `POST /profile/password` | `profile.password` | 登录。校验当前密码，成功后撤销全部刷新令牌 |
| `GET /profile/notifications` | `notify.preferences` | 登录 |
| `PUT /profile/notifications` | `notify.savePreferences` | 登录，支持部分字段 |

### 展会

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /exhibitions` | `exhibitions.list` | 可匿名。`?query=` 模糊匹配标题 / 地点 / 分类 / 简介 |
| `GET /exhibitions/month` | `exhibitions.month` | 可匿名。`?year=&month=&day=`，返回 `{ year, month, day, monthLabel, eventDays, exhibitions, selected }` |
| `GET /exhibitions/categories` | `exhibitions.categories` | 可匿名。管理员配置的分类 |
| `GET /exhibitions/:id` | `exhibitions.get` | 可匿名。返回 `{ found, exhibition, fields }` |
| `POST /exhibitions` | `exhibitions.save` | 展商 / 管理员 |
| `PUT /exhibitions/:id` | `exhibitions.save` | 展商本人或管理员 |
| `DELETE /exhibitions/:id` | `exhibitions.delete` | 展商本人或管理员 |
| `PUT /exhibitions/:id/status` | `exhibitions.status` | 同上。`{ status }` 接受中文标签或英文代码 |
| `GET /exhibitions/:id/fields` | `exhibitions.fields` | 可匿名。没有配置过时返回默认三项收集项 |
| `PUT /exhibitions/:id/fields` | `exhibitions.saveFields` | 展商本人或管理员，整体覆盖 |

### 报名、审核与核销

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /registrations` | `registrations.list` | 登录。**只返回自己的报名**（展商看别人报名走 `/review`） |
| `GET /registrations/:id` | `registrations.get` | 本人或管理员 |
| `POST /registrations` | `registrations.submit` | 登录。见下面「报名规则」 |
| `DELETE /registrations/:id` | `registrations.cancel` | 本人，且只能撤销未撤销的报名 |
| `GET /review` | `review.list` | 展商本人或管理员。`?exhibitionId=&status=`，返回 `{ records, counts }` |
| `GET /review/:id` | `review.get` | 同上 |
| `PUT /review/:id/status` | `review.updateStatus` | 同上 |
| `POST /checkin` | `checkin.scan` | 展商本人或管理员。`{ code }` |

### 用户、搜索与设置

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /users` | `users.list` | 管理员。`?query=` |
| `GET /users/:id` | `users.get` | 管理员 |
| `PUT /users/:id/status` | `users.status` | 管理员。不能改自己的状态 |
| `GET /users/public` | `users.public` | 可匿名。`?userId=` 或 `?nickname=`；按隐私开关决定是否返回报名记录 |
| `GET /search` | `search.query` | 可匿名。`?query=`，返回 `{ query, exhibitions, users, count }` |
| `GET /settings` | `settings.get` | 可匿名。服务器设置 + 当前用户通知偏好 + 个人外观模式 |
| `PUT /settings` | `settings.save` | 管理员。扁平字段补丁，只改出现过的项 |
| `PUT /settings/ui-mode` | `settings.uiMode` | 可匿名。只接受 `auto / light / dark` |

## 业务规则（服务端兜住的部分）

这些规则以前只在页面里，改接口就能绕过；现在服务端也校验一遍：

- **报名窗口**：展会状态必须是「需审核 / 无需审核」；`registration_start` / `registration_end` 存在时必须在窗口内（用数据库 `CURRENT_DATE` 比较）；「仅展示 / 截止报名 / 已结束」分别给出对应提示。
- **重复报名**：同一用户同一展会只允许一条未撤销的报名，由部分唯一索引 + 应用层双重拦截（唯一冲突不会变成 500）。
- **自动通过**：「无需审核」的展会提交即 `approved`，其余为 `pending`。
- **审核流转**：状态只接受五种中的值；展商只能改自己举办的展会的报名。
- **核销**：只有「已通过」的报名能核销；重复核销给出 `duplicated:true` 与提示；报名码与展会必须匹配；展商只能核销自己展会的报名码。
- **隐私**：用户公开页的报名记录只有本人、管理员，或该用户打开了 `showRegistrations` 时才返回；管理员视角带 `viewedAsAdmin` 标记。
- **字符数上限**：标题、地点、简介、报名答案等长度取管理员配置的 `limits`，页面被绕过也拦得住。
- **密码**：bcrypt 哈希存储；改密码后撤销该用户全部刷新令牌。
- **权限**：访客不能报名与编辑；普通用户不能碰展会配置与用户管理；展商只能管理自己举办的展会；服务器设置只有管理员能改。

## 数据模型

- **状态存英文代码**（`pending/approved/rejected/cancelled/attended`、`review/optional/display/closed/ended`、`active/limited/banned`），中文标签只在 `src/domain/labels.js` 映射一次 —— 那里是与前端 `core/status.js`、原生 `RegistrationReviewStore` 约定的同一批字符串，改动要三处同时改。
- **展会日期只存 `exhibition_date`**，年 / 月 / 日由 SQL 派生（`src/domain/queries.js` 的 `EXHIBITION_COLUMNS`），不会出现三者互相漂移；日期一律用 `to_char` 取成字符串，避免时区把日期挪一天。
- **报名记录不冗余展会标题 / 时间 / 地点**，读取时 JOIN 展会表，展会改期后不会两边不一致。
- 迁移按编号记录在 `schema_migrations`，只跑没跑过的步骤；新增字段请追加新步骤，不要改已发布的那一步。
- 表：`users`、`exhibitions`、`exhibition_fields`、`registrations`、`app_settings`、`notification_preferences`、`refresh_tokens`、`notifications`。

## 环境变量

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `DB_HOST` / `DB_PORT` | PostgreSQL 地址和端口 | `127.0.0.1` / `5432` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 数据库凭据 | 仅本地配置 |
| `JWT_SECRET` | 访问令牌密钥 | 至少 32 个随机字符 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥 | 至少 32 个随机字符 |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | 令牌有效期 | `15m` / `7d` |
| `CORS_ORIGIN` | 允许的来源 | WebView 场景用 `*` |
| `LOG_LEVEL` | `quiet` 可关掉请求日志 | `info` |
| `DEMO_PORT` | 旧的零依赖演示后端端口 | `4000` |

真实 `.env` 不得提交；`.env.example` 里放占位值。

## 测试

```bash
npm run test:contract     # node --test test/api.test.js —— 逐接口的契约与规则测试（需要数据库）
npm test                  # jest：不依赖数据库的纯函数单测
npm run lint
```

`test/api.test.js` 会自己起一个服务实例（随机端口）并连真实数据库，逐接口断言：

- 页面真正用到的字段都在（展会 25 个字段、报名、审核统计、启动数据的 12 个配置块）；
- 权限确实拦得住（访客 / 普通用户 / 展商越权访问）；
- 业务规则确实生效（报名窗口、重复报名、自动通过、核销状态流转、隐私开关）。

字段漂移会在这里失败，而不是在页面上静默渲染成空。

## 上线前必须处理

- 更换两个 JWT 密钥、限制 `CORS_ORIGIN`、启用 TLS，并去掉客户端侧的明文放行（`usesCleartextTraffic` 与 `MIXED_CONTENT_ALWAYS_ALLOW`）；
- 上传的媒体目前仍在客户端私有目录（`files/media`），需要补对象存储与上传接口；
- 通知只有数据库落点，还没有推送通道；
- 系统日历、分享、摄像头属于设备能力，永远留在客户端（`calendar.status` / `calendar.toggle` 等动作不进 API）。
