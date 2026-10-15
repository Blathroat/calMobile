# CalMobile 后端服务

`server/` 是与 Android 客户端并列的 Node.js 服务：**Hono + PostgreSQL**，提供客户端全部数据接口。前端只认 `web/src/api/client.ts` 的类型化领域 API，契约测试使用 `web/api-endpoints.mjs` 的动作表，因此后端换实现不影响页面。

开发与运行要求 Node.js 24.15+（24.x）或 26+。依赖通过 `pnpm-lock.yaml` 锁定；在受支持的 Node 版本下使用 `pnpm install --frozen-lockfile`。

| 目录 | 说明 |
| --- | --- |
| `src/index.ts` | 入口：解析运行环境、创建 Hono 应用、起服务 |
| `src/server/` | 服务骨架（Hono）：公共层、探针、状态页、业务路由和统一错误处理 |
| `src/http/` | HTTP 层的公共件：错误分类、客户端 IP、JSON 体积上限、写操作信封 |
| `src/routes/` | 按资源分的路由（Hono 认证、资料、展会、报名、审核、核销、用户、搜索、设置、启动数据） |
| `src/domain/` | 业务层：状态词汇、SQL 片段、响应映射、权限、校验、设置、会话 |
| `src/config/` | 连接池、迁移与示例数据、JWT 与邮件通道配置 |
| `src/services/` | 邮件发送适配层与验证码邮件文案（`mailer.ts` / `mail-templates.ts`） |
| `src/middleware/auth.ts` | JWT 认证中间件 |
| `src/routes/status.ts` + `src/status-page.ts` | 健康状态页：JSON 报告 + 单文件中文 HTML 组装器 |
| `status-page/` + `scripts/build-status-page.ts` | 状态页可读源码与构建期内联资源；运行时输出仍是单文件 HTML |

## 工程结构

`package.json` 里是 `"type": "module"`：源码与构建产物都是 ES Module。由此定下三条硬约束：

- **相对导入必须写扩展名**：`./config/pool.js` 这样写（源文件是 `.ts`、产物是 `.js`）。`tsconfig.json` 用 `moduleResolution: nodenext`，与 Node 的解析规则一致，不会出现「源码能跑、产物找不到模块」；
- **读 JSON 要带 `with { type: 'json' }`**：服务版本号就是这么从 `package.json` 取的；
- **没有 `require()`，也没有 `require.main`**：入口判断在 `src/entry.ts` 的 `isEntry(import.meta.url)`；接口清单直接来自各 Hono 路由模块导出的注册表。

`allowJs` 关闭：源码一律 `.ts`，没有 JS 逃生口。未自带类型声明的 CommonJS 依赖（`nodemailer`）在 `src/types/packages.d.ts` 里只按实际用到的签名声明，够用即可。访问令牌使用 `jose`，刷新令牌仍是随机串并只存哈希。

### 服务骨架与路由

骨架在 `src/server/`（Hono + `@hono/node-server`）：一层层是 **安全响应头 → CORS → 请求日志 → JSON 体积守卫 → 路由 → 统一错误处理 / 404**。打开的探针由它直接回答；关掉的与未知路径一样是 JSON 404。报名站打开时，页面回退到 `web/dist-join` 的 `join.html`；`/api`、`/media` 和探针仍是 JSON。配了 `PUBLIC_BASE_URL` 时，只有报名站页面会按 Host 做 308。

认证、资料与安全、启动数据、用户管理、搜索、设置、展会、报名、审核、核销和状态页都直接挂在 Hono 上。所有正文由 Hono 路由读取，公共层统一处理安全头、CORS、日志和体积上限。

响应一律带一套安全头（`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: no-referrer`、`Strict-Transport-Security`、`Cross-Origin-Opener-Policy`、`Cross-Origin-Resource-Policy`、`Origin-Agent-Cluster`、`X-DNS-Prefetch-Control`、`X-Download-Options`、`X-Permitted-Cross-Domain-Policies`、`X-XSS-Protection`），取值与 Hono 自带的 `secureHeaders` 默认集一致；服务不广播 `X-Powered-By`。

每一步的取舍与替代方案记在 `docs/adr/0001-server-hono-typescript.md`。

`src/` 的模块图是**无环**的：`config/auth.ts` 只导纯函数，进程级的那份配置由 `config/env.ts` 统一解析（`loadProcessConfig()`），要用密钥的模块自己去取，谁也不依赖谁。

## 快速开始

```bash
cd server
pnpm install --frozen-lockfile
cp .env.example .env
# 将 JWT_SECRET 与必填的 TOTP_SECRET_KEY 换成各自独立、至少 32 个字符的随机密钥

# 起数据库与本地收件箱（在仓库根目录；幂等，已起过就直接返回状态）
docker compose up -d
# 只想单个起：docker compose up -d db / docker compose up -d mailpit
# 定义见仓库根的 docker-compose.yml：postgres:18-alpine + Mailpit，
# 端口 127.0.0.1:5432（数据库）/ 1025（SMTP）/ 8025（收件箱网页）

pnpm db:migrate               # 可反复执行，只跑没跑过的迁移
pnpm db:seed                  # 仅开发库：示例账号与展会（可反复执行；生产会拒绝）

# 不想开收件箱容器也行：把 .env 的 MAIL_TRANSPORT 改成 console，整封邮件（含验证码）进后端日志

pnpm dev                      # 开发模式（tsx watch，改源码自动重启），默认 http://127.0.0.1:3000
                              # 同时构建并托管浏览器报名站：http://localhost:3000/
```

### 开发模式与生产模式

`pnpm start` 会自动进**生产模式**（脚本里就是 `node dist/index.js --production`），`pnpm dev` 留在开发模式：

| | `pnpm dev` | `pnpm start` |
| --- | --- | --- |
| `NODE_ENV` | `.env` 里的 `development`（或注入的真实值） | `production`（`--production` 压过 `.env`） |
| `/status` 与 `/api/v1/status` | 打开 | **关闭**（与未知路径同一句 404）；需要时 `ENABLE_STATUS_PAGE=true` 打开，并自行限制来源 |
| `/health` | 打开 | **关闭**；需要时 `ENABLE_HEALTH=true` |
| 浏览器报名站 | 打开 | **关闭**；需要时 `ENABLE_WEB=true`，且 `web/dist-join` 必须已经构建 |
| 启动前配置自检 | 不检查 | **致命项拒绝启动**：开发用的 JWT 密钥、`DB_PASSWORD=postgres`、未配置或仍是示例口令的 `ADMIN_PASSWORD`、`MAIL_TRANSPORT=console|memory`、占位或缺失的发件人地址；库里仍能用示例口令登录的 `demo` / `exhibitor` / `user` 也会拒绝启动。可疑项（Mailpit 地址、`CORS_ORIGIN=*`、没配 `TRUST_PROXY`、`LOG_LEVEL=debug`、显式打开状态页或 `/health`）只打警告 |
| 初始管理员 | `pnpm db:seed` 的示例账号 | `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`。只在该用户名还不存在时创建，不覆盖已有密码。生产不要跑 `db:seed` |
| 发信通道 | 缺省 `console` | 缺省 `smtp`，且 `memory` 被拒 |
| 迁移目标 | `pnpm db:migrate`（开发库） | `pnpm db:migrate:prod`（会先打印 `[production] 目标库 host:port/db`） |
| 存活探针 | `/ping`、`/health` | 只留 `/ping`（编排探活用它；`ENABLE_PING=false` 可关） |

判定集中在 `src/config/runtime.ts`（纯函数 `resolveRuntime(argv, env)`，有用例钉住优先级），启动自检在 `src/config/production.ts`。`tsx src/index.ts` 直接跑、不带参数时是**开发模式**——生产请用 `pnpm start` 或显式 `NODE_ENV=production`，别用裸命令，否则状态页会开着。

开发库示例账号：`demo`（管理员）、`exhibitor`（展商）、`user`（普通用户），密码都是 `password`。生产环境不使用这组账号。

起好之后浏览器打开 **http://127.0.0.1:3000/status** 就是后端与数据库的状态页（开发模式默认打开；`pnpm start` 的生产模式默认关闭，见下面的「开发模式与生产模式」）：徽章一眼看出「正常 / 异常」，下面按卡片列出服务信息、数据库（连通、延迟、版本、连接池）、迁移、各表数据量、自检项与接口清单，默认每 5 秒自动刷新一次。页面源码拆在 `status-page/template.html`、`styles.css`、`client.ts`，`pnpm build` 会把它们编译成 `src/status-page-assets.ts`，响应时仍输出单文件、自包含 HTML。开发时 `pnpm dev` 由单一 `tsx watch` 入口监视 `src/` 与 `status-page/`，改动后重建内联资源并重启服务。**后端在数据库不可用时也照常启动**（日志里给警告，不再直接退出），因此库挂了页面照样打得开，并显示通用失败提示。探活脚本读同一份数据的 JSON 版：`GET /api/v1/status`（正常 200，异常 503）。

### 数据库：Docker Compose

```bash
docker compose up -d           # 起数据库与收件箱（在仓库根目录执行）
docker compose ps              # 容器状态
docker compose logs -f db      # 跟日志
docker compose exec db psql -U postgres -d calmobile_dev
docker compose stop            # 停（数据留在命名卷 calmobile-pgdata 里）
docker compose down -v         # 删容器与数据卷，从零重来
```

日常也可以用 `scripts/db.ps1` 这个薄封装（同样的动作加便利输出）：

```bash
pwsh -File ..\scripts\db.ps1 start      # up -d db，并等到就绪
pwsh -File ..\scripts\db.ps1 status     # 容器状态 + 时区 / 当前日期 / 库列表
pwsh -File ..\scripts\db.ps1 stop       # 停容器（数据保留）
pwsh -File ..\scripts\db.ps1 reset      # 删容器与卷，从零重来
pwsh -File ..\scripts\db.ps1 psql       # 直接进 psql
```

容器固定 `postgres:18-alpine`、`--restart unless-stopped`，只监听 `127.0.0.1:5432`，所以 `server/.env` 不用改。

**卷要挂在 `/var/lib/postgresql`，不是 `/var/lib/postgresql/data`**：PostgreSQL 18 起官方镜像把数据目录改成 `/var/lib/postgresql/18/docker`（见 [docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259)），入口脚本发现 `/var/lib/postgresql/data` 里有 `PG_VERSION` 会直接拒绝启动。数据卷也不能跨大版本复用（PG16 的数据文件 PG18 用不了），所以从 16 升到 18 必须 `docker compose down -v`（或 `pwsh -File ..\scripts\db.ps1 reset`）删掉旧容器与卷、从零重来（再 `pnpm db:migrate; pnpm db:seed`）；要保数据就先 `pg_dump` 再 `pg_restore`。

**容器必须设时区**：镜像默认 UTC，而数据库的 `CURRENT_DATE` 决定报名窗口与日历落点。不设 `TZ`/`PGTZ`/`-c timezone=` 的话，本机 00:00–08:00 这段时间里数据库的「今天」还停在昨天，演示会出现莫名差一天。compose 文件里已经带上了 `Asia/Shanghai`。

### 让 Android 端连上

页面运行在 `https://appassets.androidplatform.net` 这个 HTTPS 上下文，而后端是明文 HTTP：

```bash
# 1. 端口转发：真机与模拟器都适用
#    pnpm dev 启动时已经自动接好并在运行期间看护（每 5 秒查一次，没设备时降到 15 秒），
#    所以「只跑 pnpm dev」也能直接调试；这一行是手动兜底（服务不是用 pnpm dev 起的、
#    或你把自动接通关了的时候）。
adb reverse tcp:3000 tcp:3000

# 2. 允许混合内容：WebShellActivity 已设 MIXED_CONTENT_ALWAYS_ALLOW
#    后端改 HTTPS 后应改回 MIXED_CONTENT_NEVER_ALLOW，并去掉 manifest 的
#    usesCleartextTraffic 与 INTERNET 权限说明
```

映射**不写盘**：adb server 重启、设备重连、换一台设备、机器重启都会丢，丢了以后应用里每个请求都失败（页面提示「连不上后端服务」），看起来像「后端没起」——这是最常见的假故障。自动接通的日志长这样：

```
已接通设备 tcp:3000 → 本机 tcp:3000（adb reverse）；映射丢了会自动补回来。
```

`ADB_REVERSE=0` 关掉自动接通（要自己管 adb 时）；adb 不在 PATH 时用 `ADB` 指定路径，接了多台设备时用 `ANDROID_SERIAL` 选设备。判定逻辑在 `src/dev/adb-reverse.ts`，只有开发入口 `scripts/dev.ts` 引入它。

改了 `src/*.ts` 之后**必须重启进程**：Node 会缓存已加载的模块，旧进程会继续按改之前的逻辑应答。

### 邮件：验证码与两步验证的通道

验证码走**托管中继或本地收件箱**，不在应用服务器上自建 SMTP —— 自建的账看着免费，实则最贵：国内云默认封 25 端口、要固定公网 IP 的反解析、要 SPF/DKIM/DMARC 与几周 IP 预热，而验证码一旦进垃圾箱，注册流程就直接废掉。

| 通道（`MAIL_TRANSPORT`） | 用途 | 邮件去哪 |
| --- | --- | --- |
| `console` | 本地零配置开发：整封邮件（含验证码）打进后端日志 | 你看日志 |
| `smtp` | 开发指向 Mailpit，生产指向阿里云邮件推送 / 腾讯云 SES / Resend 等 | 收件箱 |
| `memory` | 只给自动化测试用；**生产配了也会被拒并降级为 `smtp`** | 用例内存 |

```bash
docker compose up -d mailpit             # 起 Mailpit（容器 calmobile-mail，SMTP 1025 / 收件箱 8025）
pwsh -File ..\scripts\mail.ps1 status    # 容器状态 + 邮件数与最近几封
pwsh -File ..\scripts\mail.ps1 clear     # 跑回归前清空，免得看错邮件
```

收件箱在 http://127.0.0.1:8025 ，`.env` 里对应 `MAIL_SMTP_HOST=127.0.0.1`、`MAIL_SMTP_PORT=1025`、`MAIL_SMTP_SECURE=false`。生产换成托管中继的 SMTP 地址与凭据即可，代码不动。

两条工程约定（都有对应用例钉住）：

1. **发码接口先落库、立刻回包，后台发信**：前端 `api.js` 的请求超时是 3 秒，同步等一次 SMTP 往返（本机 Mailpit 实测约 1.3 秒，跨境中继更久）会把注册页卡成超时错误。发信结果只写 `mail_log`，页面不等它。
2. **发信失败要让用户看见**：`send()` 不抛异常，返回 `{ ok:false, error }`；`/status` 的「邮件通道」自检项显示通道配置与最近 24 小时的失败数。「发信成功但用户收不到」是最难查的一类故障，留痕与自检比日志翻滚有用得多。

邮件文案在 `src/services/mail-templates.ts`，那是**唯一允许写死后端用户可见中文的地方**（前端文案才走 `res/values/strings_frontend.xml`）：中英双语同封，不放链接（带链接既是钓鱼邮件的典型特征、会拉低送达率，也养成用户点邮件里链接的坏习惯），品牌名进 HTML 前转义、进主题前清换行（品牌名来自管理员设置，不清就是邮件头注入）。

## 响应约定

前后端只有两套约定，页面与 `api.js` 都按它判断：

| 情况 | HTTP | 响应体 | 前端行为 |
| --- | --- | --- | --- |
| 读取成功 | 200 | 数据本身（数组或对象） | 直接渲染 |
| 写入成功 | 200 | `{ ok:true, error:'', ...附加字段 }` | 按附加字段就地更新界面 |
| **校验 / 业务规则失败**（参数不合法、状态不允许、重复报名、数量超限） | 200 | `{ ok:false, error:'中文原因' }` | `if (!result.ok)` 就地提示 |
| 未登录 / 令牌失效 | 401 | `{ error }` | `api.js` 会先用刷新令牌换一次，失败则抛错由页面提示 |
| 无权访问 / 找不到目标 | 403 / 404 | `{ error }` | 抛错提示（不伪装成 200 成功） |
| 请求体不是合法 JSON / 超过 2MB | 400 / 413 | `{ error }` | 抛错提示（body-parser 的错误被归一成这两类，不再变成 500） |
| **数据库暂时不可用**（没起、连接被拒、握手超时、连接数打满、管理员关库、库或密码不存在） | 503 | `{ error:'数据库暂时不可用，请稍后重试' }` | 抛 `TransportError`，页面提示可重试 |
| 其它服务器内部错误 | 500 | `{ error:'服务器内部错误' }` | 抛错；原因（含堆栈）只进服务端日志 |

也就是说 **HTTP 状态码表达认证、授权、可用性与内部故障，业务规则的失败一律 200 + `ok:false`**。写路由统一用 `mutate()` 收尾（实现位于 `http/respond.ts`，信封逻辑位于 `http/envelope.ts`），它只把 400 / 409 收成信封，401 / 403 / 404 继续上抛。

两条纪律（`src/http/error-response.ts` 的 `statusFor()` / `clientMessage()` 是唯一实现处，Hono 的 `onError` 统一使用它）：

- **不把内部细节回给调用方**：只有 `ApiError` 的文案是写给用户看的，pg 的连接错误（含内网 `host:port`）、SQL 片段、文件路径与堆栈一律只出现在服务端日志里；
- **库故障不是 500 而是 503**：判定在 `domain/errors.ts` 的 `isDatabaseUnavailable()`（连接类 errno、PostgreSQL 的 `08xxx` / `57P0x` / `53300` / `3D000` / `28P01`，以及驱动的池等待超时文案），SQL 语法错、唯一约束冲突这类**不算**不可用，仍按 500 / 409 走。

存活探针与健康检查不是一回事：`GET /ping` 与 `GET /health` 只回答「HTTP 进程还在不在」（**不看数据库**，库挂了照样 200）；要连数据库一起判断用 `GET /api/v1/status`（库答不上就 503）。编排里做就绪探针请用后者。

## 接口清单

基础路径 `/api/v1`。括号里是对应的前端动作名。

### 启动与认证

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /bootstrap` | `bootstrap` | 可匿名。一次下发 `user / theme / ui / capabilities / categories / review / media / announcement / brand / limits / server / calendar`（含 `calendar.landing` 落点月份） |
| `POST /auth/login` | `auth.login` | **用户名或已验证邮箱** + 密码换 `token` + `refreshToken`，并更新最近登录时间。可带稳定设备凭据 `{ deviceToken, deviceName }`；两步验证已开启且设备未记住时**不发令牌**，只回 `{ twoFactorRequired, ticket, ..., methods }`。选中的 TOTP 或邮箱方式决定主验证码；邮箱方式登录时发码，TOTP 方式不自动发邮件；已记住设备以密码登录后可直接建会话 |
| `POST /auth/login/verify` | `auth.loginVerify` | 两步验证第二步：`{ ticket, code, deviceToken, deviceName, trustDevice }` → 会话。`code` 可以是选定的 6 位验证码或 `XXXXX-XXXXX` 形式的一次性备用码；`trustDevice:true` 仅在验证通过后记住本机。先验码再消费票，码错了票还能接着用，票单次使用；码不对 / 过期是 200 + `ok:false` |
| `POST /auth/login/code` | `auth.loginCode` | 两步验证：用同一张票补发一封邮箱验证码（票没过期就还有效），限流同上 |
| `POST /auth/register` | `auth.register` | 注册**第一步**：校验用户名 / 密码 / 邮箱与查重，把待建账号暂存进验证码记录并发码；**不建账号、不发令牌**。限流：同一邮箱 60 秒 1 条 / 1 小时 5 条 / 24 小时 15 条，同一 IP 1 小时 20 条（429） |
| `POST /auth/register/verify` | `auth.registerVerify` | 注册**第二步**：验证码通过才建账号（`email_verified = true`）并发令牌；码不对 / 过期 / 次数用尽是 200 + `ok:false` |
| `POST /auth/password/forgot` | `auth.forgotPassword` | 找回密码第一步：给**已验证邮箱**的账号发码。**不区分邮箱是否存在**——不存在的邮箱同样走一遍限流与落库，只是不发信；两种情况响应字段与耗时都一致（防账号枚举）。只给未封禁账号发 |
| `POST /auth/password/reset` | `auth.resetPassword` | 找回密码第二步：验证码通过 → 改密码 → **撤销该用户全部会话并清除可信设备**（密码可能已泄露，其它设备的登录状态要一起断）。密码校验在消费验证码之前，两次不一致不会烧掉这枚码 |
| `POST /auth/guest` | `auth.guest` | 只返回访客态，不发令牌 |
| `POST /auth/logout` | `auth.logout` | 撤销该刷新令牌 |
| `POST /auth/refresh` | — | 刷新令牌换新令牌（轮换：旧的立即作废） |

### 资料与偏好

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /profile` | `profile.get` | 登录 |
| `PUT /profile` | `profile.save` | 登录。只写出现过的字段（个人页保存资料不会顺带改隐私开关）；**不接受 `email`** —— 邮箱是身份凭据，必须走下面的改邮箱两步流程 |
| `POST /profile/password` | `profile.password` | 登录。需要五分钟、单次且绑定当前会话与 `password` 用途的 `stepUpToken`；密码改动成功后撤销全部会话并清除可信设备 |
| `GET /profile/notifications` | `notify.preferences` | 登录 |
| `PUT /profile/notifications` | `notify.savePreferences` | 登录，支持部分字段 |
| `GET /profile/security` | `security.get` | 登录。返回 `{ email, emailVerified, emailVerifiedAt, twoFactorEnabled, twoFactorMethod: 'off' \| 'totp' \| 'email', totpEnabled, backupCodesLeft, canEnable }` |
| `POST /profile/security/email-code` | `security.identityEmailCode` | 登录。向当前已验证邮箱发送安全操作复核码，`purpose=security`；同邮箱一分钟冷却 |
| `POST /profile/security/verify` | `security.verifyIdentity` | 登录。`{ method: 'email' \| 'totp', code, scope }`；已配置 TOTP 的账号才可选 TOTP。通过后签发五分钟、单次、绑定账号 / 当前会话 / `password`、`email`、`totp`、`totp-confirm` 或 `factor` 操作范围的票据；错误 TOTP 每会话 15 分钟最多五次 |
| `GET /profile/sessions` | `security.sessions` | 登录。按设备聚合活动会话，返回安全展示名、首次 / 最近活动时间、当前设备标记与活动会话数；id 是撤销标识，不下发设备凭据 |
| `DELETE /profile/sessions/:id` | `security.revokeSession` | 登录。撤销该设备的全部刷新令牌并清除可信设备状态；它的访问令牌也立即失效 |
| `POST /profile/sessions/revoke-all` | `security.revokeAllSessions` | 登录。撤销全部会话并清除可信设备状态，当前客户端也会回登录页 |
| `POST /profile/2fa/enable` | `security.enable2fa` | 登录。需要已消费 `factor` 复核票后才向**已验证邮箱**发开启验证码；没有已验证邮箱时 400 |
| `POST /profile/2fa/enable/verify` | `security.verify2fa` | 登录。`{ code }` 通过才把 `two_factor_enabled` 置真并选中邮箱方式；首次开启返回一批**备用码**（明文只出现这一次） |
| `POST /profile/2fa/totp/setup` | `security.totpSetup` | 登录。需要已消费 `totp` 复核票；生成验证器密钥（base32）与 `otpauth://` 地址并返回单独的 `totp-confirm` 票。新密钥先进 `totp_pending_secret`，确认前旧密钥仍有效 |
| `POST /profile/2fa/totp/enable` | `security.totpEnable` | 登录。`{ code, stepUpToken }` 对得上待确认密钥且票据属于当前会话时才替换原密钥、开启并选中 TOTP；首次绑定返回备用码，轮换保留既有备用码 |
| `POST /profile/2fa/totp/activate` | `security.totpActivate` | 登录。仅当邮箱已验证且账号保留已确认的 TOTP 密钥时一键选中并开启 TOTP，不生成新密钥或轮换备用码 |
| `POST /profile/2fa/backup-codes` | `security.backupCodes` | 登录。`{ password }` 校验后**重新生成**备用码（旧的全部作废），要求两步验证已开启 |
| `POST /profile/2fa/disable` | `security.disable2fa` | 登录。需要已消费 `factor` 复核票后关闭开关；保留已确认 TOTP 密钥与未使用备用码，支持稍后恢复 |
| `POST /profile/email` | `security.changeEmail` | 登录。`{ email, stepUpToken }` 需要已消费 `email` 复核票后把验证码发到**新**地址；与当前相同 / 已被占用会被拒。重发也需要重新复核 |
| `POST /profile/email/verify` | `security.verifyEmail` | 登录。`{ email, code }` 通过才落库，并把 `email_verified` 置真；验证码必须是为当前账号签发的 |

### 展会

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /exhibitions` | `exhibitions.list` | 可匿名。`?query=` 模糊匹配标题 / 地点 / 分类 / 简介。每条带 `exhibitorRole`（主办人角色代码，没有主办人时为空） |
| `GET /exhibitions/month` | `exhibitions.month` | 可匿名。`?year=&month=&day=`，返回 `{ year, month, day, monthLabel, eventDays, markedDays, exhibitions, meetings, selected }`。`eventDays` 是有展会的日期；`markedDays` 只在已登录时返回和该用户有关的日期，匿名为空数组。`meetings` 是该用户作为申请人或主办人的待审核、已通过私人会议，已拒绝和已撤销不返回；未登录为空数组。每条会议的 `role` 是 `host` 或 `visitor`，`titleRole` 是标题里那个人的角色代码 |
| `GET /exhibitions/categories` | `exhibitions.categories` | 可匿名。管理员配置的分类 |
| `GET /exhibitions/:id` | `exhibitions.get` | 可匿名。返回 `{ found, exhibition, fields }` |
| `POST /exhibitions` | `exhibitions.save` | 展商 / 管理员。受限账号 403 |
| `PUT /exhibitions/:id` | `exhibitions.save` | 展商本人或管理员。受限账号 403 |
| `DELETE /exhibitions/:id` | `exhibitions.delete` | 展商本人或管理员。受限账号 403 |
| `PUT /exhibitions/:id/status` | `exhibitions.status` | 同上。`{ status }` 接受中文标签或英文代码；受限账号 403 |
| `GET /exhibitions/:id/fields` | `exhibitions.fields` | 可匿名。按 `position` 返回这场展会的收集项；**没有配置过就是空数组**，不塞默认项 |
| `PUT /exhibitions/:id/fields` | `exhibitions.saveFields` | 展商本人或管理员，整体覆盖；受限账号 403 |

### 报名、审核与核销

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /registrations` | `registrations.list` | 登录。**只返回自己的报名**（展商看别人报名走 `/review`） |
| `GET /registrations/:id` | `registrations.get` | 本人或管理员 |
| `POST /registrations` | `registrations.submit` | 登录。见下面「报名规则」 |
| `DELETE /registrations/:id` | `registrations.cancel` | 本人。待审核可撤销；已通过还要展会 `allow_cancel` 为真；已参加不能撤销 |
| `GET /review` | `review.list` | 展商本人或管理员。`?exhibitionId=&status=`，返回 `{ records, counts }`。记录带 `visitorRole`（报名人角色代码，账号已删除时为空） |
| `GET /review/:id` | `review.get` | 同上 |
| `PUT /review/:id/status` | `review.updateStatus` | 同上 |
| `POST /checkin` | `checkin.scan` | 展商本人或管理员。`{ code }`；受限账号 403 |

### 私人会议

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /meetings/settings` | `meetings.settings` | 展商或管理员。返回接受开关、撤销开关、预约说明、是否被强制关闭、收集项 |
| `PUT /meetings/settings` | `meetings.saveSettings` | 展商或管理员。`{ acceptMeetings, allowCancel, notice, fields }`。受限或封禁 403，并强制关闭接受开关 |
| `GET /meetings/mine` | `meetings.mine` | 登录。只返回自己提交的申请，含已撤销。每条带 `exhibitorRole` 与 `visitorRole` |
| `GET /meetings/:id` | `meetings.get` | 申请人、主办人或管理员。查不到时 `{ found:false }` |
| `GET /meetings/inbox` | `meetings.inbox` | 不带 `exhibitorId` 时看自己的收件箱（展商或管理员）；管理员带 `?exhibitorId=` 看指定的展商或管理员。记录带 `visitorRole` |
| `GET /meetings/apply/:exhibitorId` | `meetings.form` | 登录。返回是否开放、主办人 `roleCode`、预约说明和收集项；未开放时不返回收集项 |
| `POST /meetings` | `meetings.submit` | 登录且可报名。`{ exhibitorId, meetingDate, meetingTime, answers }`。规则失败 200 + `ok:false` |
| `POST /meetings/:id/cancel` | `meetings.cancel` | 申请人。待审核可撤销；已通过还要主办人允许；已拒绝不能撤销 |
| `PUT /meetings/:id/status` | `meetings.setStatus` | 展商本人或管理员。被限制的会议展商改不了（403） |
| `PUT /meetings/:id/lock` | `meetings.setLock` | 管理员。`{ locked }` |
| `DELETE /meetings/:id` | `meetings.remove` | 管理员 |

### 用户、搜索与设置

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /users` | `users.list` | 管理员。`?query=` |
| `GET /users/:id` | `users.get` | 管理员 |
| `PUT /users/:id/status` | `users.status` | 管理员。不能改自己的状态 |
| `PUT /users/:id/two-factor` | `users.disable2fa` | 管理员。`{ enabled:false }` 关闭他人两步验证 —— 用户邮箱用不了时**唯一的兜底出口**（幂等；想开启只能由本人过码，所以传 `enabled:true` 会被拒） |
| `GET /users/public` | `users.public` | 可匿名。`?userId=` 或 `?nickname=`；按隐私开关决定是否返回报名记录 |
| `GET /search` | `search.query` | 可匿名。`?query=`，返回 `{ query, exhibitions, users, count }`。用户带中文 `role` 和英文 `roleCode` |
| `GET /settings` | `settings.get` | 可匿名。服务器设置 + 当前用户通知偏好 + 个人外观模式与配色（`theme.index` 是调用者**实际生效**的下标） |
| `PUT /settings` | `settings.save` | 管理员。扁平字段补丁，只改出现过的项（`themeIndex` 改的是**全局默认**） |
| `PUT /settings/ui-mode` | `settings.uiMode` | **登录**。个人外观模式，只接受 `auto / light / dark`；未登录 401（服务器级默认外观不可以被匿名改写） |
| `PUT /settings/ui-theme` | `settings.uiTheme` | **登录**。个人配色 `{ themeIndex }`，只写自己的 `users.ui_theme`；下标必须是补齐后色板范围内的整数，越界 / 非整数按规则失败（200 + `ok:false`），未登录 401 |

### 服务状态（无前端动作）

| 方法与路径 | 动作 | 权限与说明 |
| --- | --- | --- |
| `GET /api/v1/status` | — | 可匿名。JSON 健康报告：`ok` / `service` / `database` / `migrations` / `data` / `endpoints` / `checks`。服务活着**且**数据库答得上时 200，否则 503 + `ok:false`，探活脚本按状态码判断 |
| `GET /status` | — | 可匿名。同一份报告的中文状态页（构建后单文件 HTML，样式与脚本内联，不引 CDN）；数据库挂掉时仍返回 200 并显示通用失败提示 |

两个路径由 Hono 提供并共享 `src/routes/status.ts` 的报告；状态页源码位于 `status-page/`，构建后由 `src/status-page.ts` 注入清洗后的 `INITIAL`。几条约定：

- **`ok` 只表达「服务活着 + 数据库答得上」**，迁移没跑完、自检项失败都只体现在 `checks` 与 `migrations` 里，不混进状态码 —— 否则探活脚本分不清「数据库没了」和「只是有一步迁移没跑」。
- **每一项都是真测出来的**：`database.latencyMs` 是 `select version()` + `select 1` 的往返时间，`data` 是逐表 `count(*)`，`checks` 里失败的那条一定指得到出处；数据库连不上时 `data` 是 `null`（不是 0）、迁移按「全部未应用」处理、错误详情只写服务端日志，响应使用通用提示，绝不抛 500。
- **`endpoints` 就是真实路由表**：它读取各 Hono 路由模块导出的注册表（与 `src/test/api.test.ts` 的 `backendRoutes()` 同一套来源），新增路由不会漏登记。这两个状态接口本身不进前端动作表。
- 两个路径都带 `Cache-Control: no-store`，客户端不会缓存；服务端只在 1.5 秒内复用报告，页面每 5 秒刷新仍能避免紧邻请求重复查询。
- 服务**先起、数据库后挂**与**数据库先挂、服务后起**都能看到状态页：`start()` 在连不上库时只记一条警告，不再让进程退出。
- **探测不会把连接池占满**：状态页 5 秒自刷新一次，每次要跑 9 条查询，因此 `reportOnce()` 把并发请求合并成同一次探测，并在 1.5 秒内复用报告；探测查询用 `pool.connect()` + 超时 `release(true)` **销毁**那条连接（`Promise.race` 只放弃 promise，连接会一直被占着），连接池另有 `statement_timeout: 10s` 兜慢查询。
- 已知边界：探针自己出错时给 `{ ok:false }` + `checks` 里一条失败项（`fallbackReport()`），不会 500 —— 唯一的排查入口不能跟着坏掉。

## 媒体与上传限制

`app_settings.media` / `app_settings.upload` 是管理员在「管理-设置」里维护的容量与格式上限，**同一个 payload 同时供 `GET /bootstrap`（`media` 块）与 `GET /settings`（`media` + `upload`）使用**（`domain/settings.ts` 的 `readServerSettings()`），两处字段不会漂移：

| 键 | 默认值 | 取值范围 | 消费方 |
| --- | --- | --- | --- |
| `media.imageCount` | 8 | 1–30 | 一次最多选几张图 |
| `media.imageSizeMb` | 10 | 1–50 | 单张图片容量上限（MB） |
| `media.videoCount` | 2 | 0–10 | 一次最多选几段视频 |
| `media.videoSizeMb` | 50 | 1–500 | **单段视频容量上限（MB）**。原生侧由 `ui.sync` 同步到 `AppSettings.getMediaVideoSizeMb()`，`MediaActions` 用它算 `limitMb`（为 0 会变成「不限」，因此这里不给 0） |
| `upload.avatarSizeMb` | 2 | 1–20 | 头像容量上限（MB）。与 `UPLOAD_MAX_MB` 取较小值后，由 `POST /api/v1/profile/avatar` 执行 |
| `upload.avatarFormats` | `jpg,jpeg,png,webp` | 这四者的非空子集 | 头像允许的后缀。裁剪结果按这个列表导出，不在列表里的后缀保存时会被拒绝 |
| `upload.imageFormats` | `jpg,jpeg,png,webp` | 非空列表 | 允许的图片格式（展会封面与简介，不含头像） |
| `upload.videoFormats` | `mp4,mov,webm` | 非空列表 | 允许的视频格式 |

越界值由 `domain/settings.ts` 的 `applyServerPatch()` **收敛到范围内**（不是拒绝请求），例如 `videoSizeMb: 9999` 保存后读回 500、`0` 读回 1。这几个键都是 `app_settings` 里那一项 JSON 的成员，**不是数据库列**，因此新增上限不需要迁移步骤：`readServerSettings()` 以 `DEFAULT_SETTINGS` 为底、用库里的值覆盖，老库里没有 `videoSizeMb` 时会自动拿到默认值 50，不会给出 `undefined`。

## 应用配色

色板定义在 `src/config/migrate.ts` 的 `THEME_COLORS`（**8 种**）。`app_settings.theme` = `{ index, colors }` 是**服务器级默认**（管理员在「管理-设置」里改），`users.ui_theme` 是**个人选择**（可空）。`GET /bootstrap`（`theme` 块）与 `GET /settings` 用同一份 payload（`readServerSettings()`），前端 `web/src/app/theme.ts` 按 `colors[index]` 写 `--accent*`。

- **下标语义稳定**：`index 0` 是默认的焦糖橙 `#C05621`，新色只能往后追加 —— 下标是存在库里的用户选择，换位置等于换掉所有老用户当前的强调色。原生 `AppSettings.ACCENTS` 与这里逐位对应（前端用同一个下标推 `ui.sync`）。
- **取值规则**：下发的 `theme.index` 是该调用者**实际生效**的下标 = `users.ui_theme ?? app_settings.theme.index`（`readUiTheme()`）。没选过（`NULL`）或未登录时跟随全局默认，因此老账号在这次改动后强调色不变；管理员改全局默认只影响没选过的账号。前端不用自己分支。
- **写入规则**：`PUT /settings/ui-theme` 只写调用者自己的 `users.ui_theme`，与 `PUT /settings/ui-mode` 对称，两者都要求登录。下标按**补齐后**的色板长度判定，越界 / 非整数按规则失败（200 + `ok:false`）而不是静默夹取 —— 配色是色板上的枚举选择，夹到边界会把「点错了」伪装成「保存成功」。（`PUT /settings` 的全局 `themeIndex` 仍是旧的夹取口径。）
- **老库升级**：`app_settings` 的默认值是「缺项才写」（seed 里 `ON CONFLICT DO NOTHING`），所以只改 `DEFAULT_SETTINGS` 不会影响老库。迁移 `0006-theme-palette-8` 把已存的 `theme.colors` 补齐（保留原有项、按默认色板追加缺的新色），幂等且不动 `index`；`0007-user-ui-theme` 加 `users.ui_theme`（`ADD COLUMN IF NOT EXISTS`，可反复执行）。`readServerSettings()` 还会用 `normalizeThemeColors()` 兜底，库里的色板非法 / 重复 / 缺项时也只会下发完整的 8 色。
- **越界收敛**：全局 `themeIndex` 按**补齐后**的色板长度夹到 `[0, colors.length - 1]`，不是拒绝请求；老库里被手工改大的 `index` 在读取时同样收敛。

## 业务规则（服务端兜住的部分）

这些规则以前只在页面里，改接口就能绕过；现在服务端也校验一遍：

- **报名窗口**：展会状态必须是「需审核 / 无需审核」；`registration_start` / `registration_end` 存在时必须在窗口内（用数据库 `CURRENT_DATE` 比较）；「仅展示 / 截止报名 / 已结束」分别给出对应提示。
- **报名内容**：提交时按这场展会的收集项校验（与 `GET /exhibitions/:id/fields` 同一份数据；没有配置收集项时是空数组，即没有可校验的项）——必填项不能为空，单选 / 多选的值必须落在选项里，页面被绕过后同样拦得住。
- **重复报名**：同一用户同一展会只允许一条未撤销的报名，由部分唯一索引 + 应用层双重拦截（唯一冲突不会变成 500）。
- **自动通过**：「无需审核」的展会提交即 `approved`，其余为 `pending`。
- **审核流转**：状态只接受五种中的值，且只允许白名单内的流转（待审核 → 已通过 / 已拒绝 / 已撤销；已通过 → 已参加 / 已拒绝 / 已撤销；已拒绝 → 已通过 / 已撤销；**已参加是终态**；已撤销 → 待审核 / 已通过）。越权的流转给 403，白名单之外的流转是业务失败（200 + `ok:false`）。
- **审核权限**：展商只能改自己举办的展会的报名；管理员没开「允许修改已通过或已拒绝的报名」时，展商还不能改已通过 / 已拒绝 / 已撤销的记录（403），管理员不受这条策略限制。
- **核销**：只有「已通过」的报名能核销；重复核销给出 `duplicated:true` 与提示；报名码与展会必须匹配；展商只能核销自己展会的报名码；核销请求走 `/checkin`，不受审核状态机限制。
- **隐私**：用户公开页的报名记录只有本人、管理员，或该用户打开了 `showRegistrations` 时才返回；管理员视角带 `viewedAsAdmin` 标记。公开页的每条报名都**不含 `checkInCode`**（现场核销的唯一凭据），本人与管理员走 `/registrations`、`/review` 时照常下发。
- **撤销报名**：只能撤销自己的报名，且**已参加是终态**——现场核销过的记录本人也不能再撤销（否则出勤记录可以事后抹掉），与审核流转同一口径；已撤销的记录重复撤销给出业务提示。
- **字符数上限**：标题、地点、简介、报名答案等长度取管理员配置的 `limits`，页面被绕过也拦得住。
- **密码**：bcrypt 哈希存储；安全设置里的改密码要求用途限定的身份复核票，成功后撤销该用户全部会话并清掉可信设备。登录时账号不存在也走一次 bcrypt（对固定的哑哈希比对），避免用「立即返回」与「比对后返回」的耗时差枚举出哪些用户名真实存在。
- **登录限流**：`/auth/login` 与 `/auth/register` 按「IP + 用户名」内存滑动窗口限速——**只统计失败**（4xx 或 200 + `ok:false`），5 分钟内失败 10 次之后给 429，挡住脚本化撞库；成功登录不计数，否则连着登录十来次就会把自己关在门外。单进程内存实现，多实例部署时换共享存储。
- **刷新令牌轮换**：撤销与校验合成一条条件更新（`UPDATE … WHERE revoked_at IS NULL` 并检查 `rowCount`），同一个刷新令牌并发用两次时只有一个能换到新令牌，另一个按「登录状态已失效」处理。
- **权限**：访客不能报名与编辑；普通用户不能碰展会配置与用户管理；展商只能管理自己举办的展会；服务器设置（含全局配色默认值）要管理员，个人外观模式与个人配色都要登录。
- **受限账号**（`users.status = 'limited'`）：管理员在「用户管理」里设置受限后，被判定的操作各给 403 + 一句可展示的文案 —— **不能报名**（`POST /registrations` →「账号已被限制，不能报名」）、**不能发布展会**（`POST /exhibitions` →「账号已被限制，不能发布展会」）、**不能编辑 / 删除展会**（`PUT` / `DELETE /exhibitions/:id` →「账号已被限制，不能修改展会」/「账号已被限制，不能删除展会」，自己举办的展会也不行）、**不能改报名设置**（`PUT /exhibitions/:id/status` 暂停恢复报名与 `PUT /exhibitions/:id/fields` 报名收集项 →「账号已被限制，不能修改报名设置」）、**不能核销**（`POST /checkin` →「账号已被限制，不能核销」）、**不能编辑个人信息**（`PUT /profile` →「账号已被限制，不能编辑个人信息」）。**仍然可用**：登录、浏览与查询（展会列表 / 月视图 / 详情 / 收集项读取）、审核报名（`PUT /review/:id/status` 照常可用）、`PUT /profile/notifications`（通知偏好不是个人信息）、`POST /profile/password`（改密码属于账号安全）、撤销自己的报名。**管理员不受限**（否则没人能解除限制），判定集中在 `domain/permissions.ts` 的 `isLimited()` / `assertNotLimited()`（文案表 `LIMITED_ACTIONS`）；受限拦截一律挂在 `mutate()` 之外、并排在角色检查之前，因此受限的普通用户拿到的是「账号已被限制」，而不是「只有展商或管理员可以执行此操作」。`capabilities(role, status)` 同步给出 `can.register = false`、`can.profile = false`、`can.limited = true`，前端据此置灰按钮并说明原因。封禁（`banned`）行为不变，仍然在认证层就拒绝。

## 数据模型

- **状态存英文代码**（`pending/approved/rejected/cancelled/attended`、`review/optional/display/closed/ended`、`active/limited/banned`），中文标签只在 `src/domain/labels.ts` 映射一次 —— 那里是与前端 `core/status.js` 约定的同一批字符串，改动要两处同时改。
- **展会日期只存 `exhibition_date`**，年 / 月 / 日由 SQL 派生（`src/domain/queries.ts` 的 `EXHIBITION_COLUMNS`），不会出现三者互相漂移；日期一律用 `to_char` 取成字符串，避免时区把日期挪一天。
- **报名记录不冗余展会标题 / 时间 / 地点**，读取时 JOIN 展会表，展会改期后不会两边不一致。
- 迁移按编号记录在 `schema_migrations`，只跑没跑过的步骤；新增字段请追加新步骤，不要改已发布的那一步。
- **邮箱是身份，不只是联系方式**：`users.email` 大小写无关唯一（只有空串例外，允许留空的老数据并存），`email_verified` / `email_verified_at` 记验证状态，`two_factor_enabled` 与 `two_factor_method` 保存两步验证状态和所选方法。验证码只存哈希；注册用途的待建账号暂存在 `email_codes.payload`（密码存哈希）——「先验证邮箱、通过后才建账号」因此不会往 `users` 里留下未验证的半成品。两步验证的预认证票在 `preauth_tickets`，发信留痕在 `mail_log`。
- **会话与可信设备**：`refresh_tokens` 的 `session_id` 关联 JWT 的 `sid`，按设备存令牌哈希、名称和撤销时间；认证时检查 sid 是否仍有活动刷新令牌，因此远程撤销后访问令牌也立即失效。稳定设备凭据保存在客户端设备私有存储，服务端只保存它的哈希；注册完成默认记住当时设备，登录二步验证可选择记住其他设备。
- 表：`users`、`exhibitions`、`exhibition_fields`、`registrations`、`app_settings`、`notification_preferences`、`refresh_tokens`、`trusted_devices`、`notifications`、`email_codes`、`preauth_tickets`、`mail_log`、`schema_migrations`。

## 环境变量

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `PORT` | 服务端口。API 与浏览器报名站共用，只改这一处 | `3000` |
| `PUBLIC_BASE_URL` | 报名站规范来源与分享链接。只接受 `http(s)://主机[:端口]`，非法值当没配 | `https://app.example.com` |
| `NODE_ENV` | 运行环境；`pnpm start` 传 `--production` 覆盖它 | `development` |
| `ENABLE_STATUS_PAGE` | 强制开关状态页；**生产默认关闭** | `true`（谨慎） |
| `ENABLE_PING` | `/ping` 与 `/api/v1/ping`；两种环境默认打开 | `false` 关掉 |
| `ENABLE_HEALTH` | `/health`；**生产默认关闭** | `true`（谨慎） |
| `ENABLE_WEB` | 是否托管浏览器报名站；**生产默认关闭**。打开后缺少构建产物会拒绝启动 | `true` |
| `ADMIN_USERNAME` | 生产初始管理员用户名（3–20 位） | `opsadmin` |
| `ADMIN_PASSWORD` | 生产初始管理员密码（12–32 位，不能用示例口令）。已有同名管理员时不会改写 | 随机字符串 |
| `ADMIN_EMAIL` | 生产初始管理员邮箱，须可收信 | `ops@你的域名` |
| `TRUST_PROXY` | 反向代理跳数或可信来源；反代后面必须设 | `1` |
| `DB_HOST` / `DB_PORT` | PostgreSQL 地址和端口 | `127.0.0.1` / `5432` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 数据库凭据 | 仅本地配置 |
| `DB_SSL` | 数据库 TLS；同机 Docker 不需要，托管库一般要 | `true` |
| `JWT_SECRET` | 访问令牌密钥 | 至少 32 个随机字符 |
| `TOTP_SECRET_KEY` | 必填的验证器密钥加密密钥，须长期保管；更换后用户需要重新绑定验证器 | 至少 32 个随机字符 |
| `JWT_EXPIRES_IN` / `REFRESH_TOKEN_TTL` | 访问令牌 / 刷新令牌有效期 | `15m` / `7d` |
| `CORS_ORIGIN` | 允许的来源 | `https://appassets.androidplatform.net`（页面所在的 WebView 源；配成 `http://localhost:3000` 只在浏览器直开前端时成立，真机 / 模拟器连不上） |
| `MAIL_TRANSPORT` | 邮件通道：`console` / `smtp` / `memory`（生产禁用） | 开发 `smtp`（Mailpit），或 `console` |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` | SMTP 地址与端口 | `127.0.0.1` / `1025`（Mailpit）、`465`（隐式 TLS） |
| `MAIL_SMTP_SECURE` | 是否隐式 TLS；缺省按端口推断（465 → true） | `false` / `true` |
| `MAIL_SMTP_USER` / `MAIL_SMTP_PASSWORD` | SMTP 认证凭据；不填则匿名（Mailpit 不需要） | 托管中继的账号 / API Key |
| `MAIL_FROM_ADDRESS` | 发件人地址；**生产必须显式配置** | `no-reply@你的域名` |
| `MAIL_REPLY_TO` | 回复地址（可选） | `support@你的域名` |
| `MAIL_SEND_TIMEOUT_MS` | 单封发信超时 | `8000` |
| `MAIL_SMTP_TLS_REJECT_UNAUTHORIZED` | 只有自签名内网中继才该关掉 | `false`（默认不关） |
| `LOG_LEVEL` | `quiet` 可关掉请求日志；开着时每行是 `客户端IP 方法 路径 状态码 耗时ms`。查询失败只记「查询失败」，不打印语句或参数 | `info` |

真实 `.env` 不得提交；`.env.example` 里放占位值。

迁移旧部署时，若之前没有单独配置 `TOTP_SECRET_KEY`，请将旧版 `JWT_REFRESH_SECRET` 的值原样复制到 `TOTP_SECRET_KEY`，以保持已绑定验证器的解密密钥不变；刷新令牌有效期配置使用 `REFRESH_TOKEN_TTL`。

## 测试

```bash
pnpm build                # 先构建报名站到 web/dist-join，再 tsc 编译到 dist（生产跑的就是这份产物）
pnpm typecheck            # 只做类型检查，把类型错误与测试失败分开定位
pnpm test:contract        # vitest contract project —— 逐接口的契约与规则测试（需要数据库）
pnpm test                 # vitest unit project：不依赖数据库的纯函数单测
pnpm lint                 # oxlint
pnpm format               # oxfmt
```

`src/test/api.test.ts`（78 项）会自己起一个服务实例（随机端口）并连真实数据库，逐接口断言：

- 页面真正用到的字段都在（展会 25 个字段、报名、审核统计、启动数据的 12 个配置块）；
- 权限确实拦得住（访客 / 普通用户 / 展商越权访问、受限账号在报名 / 发布 / 编辑 / 删除展会 / 改报名设置 / 核销 / 改资料上的 403 文案与仍然可用的操作、管理员即便被标成受限也不受限）；
- 业务规则确实生效（报名窗口、收集项必填与选项、重复报名、自动通过、审核状态机与 `canRevise` 策略、核销状态流转、隐私开关、媒体上限收敛与缺键兜底）；
- **注册两步流程与验证码规则**：第一步只发码、不建号、不发令牌，账号在验证通过前登不进去；错码不建号；同一枚码只能用一次；同一邮箱 60 秒内不能重复发码（429）；错够 5 次这枚码即作废（连正确的码也不再认）；发码与验证之间用户名被抢注时给「已被注册」而不是 500。
- **TOTP 与备用码**：绑定验证器要先把生成的密钥输对一次才算成功（生成密钥这一步不生效）；登录主验证码遵循 `two_factor_method` 所选的 TOTP 或邮箱方式，备用码始终可作为恢复方式；备用码一次一枚、用过的立即失效，重新生成会让旧码全部作废；关闭两步验证会保留已确认的验证器绑定与未使用备用码，之后可一键恢复。TOTP 实现对着 RFC 6238 官方向量测（`domain/totp.test.ts`），密钥在库里是 AES-256-GCM 密文。
- **找回密码与两步验证**：找回密码对已注册与未注册邮箱的响应字段完全一致（不泄露账号是否存在），但只有已注册的会真的收到邮件；改密码后旧会话与可信设备失效、身份复核票绑定当前会话且只能用一次；两步验证开启后 `POST /auth/login` 只回票不发令牌、错码仍然没令牌、过码才发令牌、同一张预认证票只能用一次；关闭两步验证要复核身份但保留 TOTP 密钥与备用码，TOTP 轮换在新码确认前保留旧密钥；改邮箱必须先复核当前身份、再把码发到新地址并通过才落库，且别人账号的改邮箱验证码用不了；验证码的明文只存在于邮件里，用例从内存收件箱的正文里把它读出来 —— 走的是用户实际收到的那条路径，后端没有、也不该有「读出明文码」的接口；
- 刷新令牌并发重放只会换到一套新令牌（轮换的撤销是原子条件更新）；
- **前后端路由交叉校验**：前端 `api.js` 的每个数据动作都有后端路由接住，后端也没有前端用不到的路由；
- **骨架公共层**：安全响应头、CORS（含预检 204）与 404 的文案在所有 Hono 业务响应上一并生效；
- 状态页在数据库不可用时如实降级（`ok:false`、`data:null`、响应不带 pg/SQL/堆栈原文，不抛 500）。

`src/**/*.test.ts`（vitest unit project，170 项）跑不依赖数据库的部分：入口判定（`entry.test.ts` —— ESM 下取代 `require.main` 的那次比对）、JWT 配置校验、认证中间件（含受限账号放行但能力位置灰）、服务器设置补丁的纯函数（`domain/settings.test.ts` —— 媒体上限收敛与缺键兜底）、**数据库不可用的判定**（`domain/errors.test.ts` 与 `http/error-response.test.ts` —— 503 的分类是状态码来源，判错会把库故障伪装成 500）、**客户端 IP 的代理信任三态**（`http/client-ip.test.ts`：不信任/跳数/来源三种取值下取址正确，跳数错一位限流就会退化成全局额度）、**JSON 体积上限与写操作信封**（`http/body-limit.test.ts`：超限 413、坏 JSON 400、业务失败 200 + `ok:false`）、**骨架自身的行为**（`server/hono-app.test.ts`：探针、404、安全头、CORS、请求日志），以及邮件与验证码：通道选择与「生产禁用 `memory`」（`config/mail.test.ts`）、`console` / `memory` 两条发信路径与邮件头注入清洗（`services/mailer.test.ts`）、验证码文案的双语 / HTML 转义 / 不放链接（`services/mail-templates.test.ts`）、验证码的形态 / 哈希加盐 / 等长比较 / 邮箱归一化（`domain/otp.test.ts`）。真发 SMTP 那条路要 Mailpit 在跑，属于本地验证而不是 `pnpm test` 的前置条件。

字段漂移会在这里失败，而不是在页面上静默渲染成空。

**数据库不可用这条路径要在真机上验证**：用假端口起一个实例（`DB_PORT=6543 PORT=3011 npx tsx src/index.ts`），断言业务接口 503 + `{ error:'数据库暂时不可用，请稍后重试' }`（不含内网地址与堆栈）、`/api/v1/status` 503、`/status` 200、`/ping` 200。只跑测试库的话，这条路径没有机器证据。

## 上线前必须处理

跨模块的发布清单见 `docs/operations.md`。与服务端直接相关的几条：

- `pnpm start`（生产模式）已经**默认关闭 `/status`、`/api/v1/status`、`/health` 和报名站**，只留 `/ping`，并会对配置做启动前自检（含 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`）；用 `TRUST_PROXY`、`ENABLE_STATUS_PAGE`、`ENABLE_WEB`、`DB_SSL` 按部署形态配一下，详见上面的「开发模式与生产模式」；
- 配置访问令牌密钥 `JWT_SECRET`、必填 TOTP 加密密钥 `TOTP_SECRET_KEY` 与数据库密码，限制 `CORS_ORIGIN`，启用 TLS，并去掉客户端侧的明文放行（`usesCleartextTraffic` 与 `MIXED_CONTENT_ALWAYS_ALLOW`）——密钥与库密码会被启动自检拦住，`CORS_ORIGIN` 目前只是警告；
- **不要把状态页对公网打开**：它给出迁移清单、各表行数与接口清单；需要启用时仍应由反代加 Basic Auth / IP 白名单，`/ping` 才是给外部探活用的事实源；
- **不要在服务器上跑 Mailpit**：`docker-compose.yml` 的 `mailpit` 服务与 `MAIL_SMTP_HOST=127.0.0.1` 只用于本地开发；生产要指向托管中继，并用专用子域配好 SPF / DKIM / DMARC（启动自检对 127.0.0.1 / 1025 会警告）；
- 生产环境不要把 `MAIL_TRANSPORT` 配成 `console`：那样验证码只写日志，用户永远收不到（`resolveMailConfig` 会拦截 `memory`，但 `console` 是合法通道，只能靠部署时确认）；
- 头像已经上传到服务器本地目录（`UPLOAD_DIR`，默认 `server/data/uploads`，由 `GET /media/avatars/:file` 分发）。展会封面和简介里的图片、视频仍在客户端私有目录（`files/media`）；
- 通知只有数据库落点，还没有推送通道；
- 系统日历、分享、摄像头属于设备能力，永远留在客户端（`ui.sync`、`calendar.status` / `calendar.toggle` 等 10 个动作不进 API）。
