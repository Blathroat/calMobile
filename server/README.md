# CalMobile 后端服务

`server/` 是与 Android 客户端并列的 Node.js 服务：Hono + PostgreSQL。前端只认 `web/src/api/client.ts`。契约以 `web/api-endpoints.mjs` 和各路由模块导出的注册表为准。状态页的接口清单读的是同一份注册表。

Node 版本见本目录 `package.json` 的 `engines`。安装使用 `pnpm install --frozen-lockfile`。

用户可见行为见 [`docs/product.md`](../docs/product.md)。发布步骤见 [`docs/operations.md`](../docs/operations.md)。环境变量以 `.env.example` 的注释为准。

## 快速开始

```bash
cd server
pnpm install --frozen-lockfile
cp .env.example .env
# 按 .env.example 的注释填写密钥

# 仓库根目录。卷、时区和端口的约束写在 docker-compose.yml 里。
docker compose up -d

pnpm db:migrate
pnpm db:seed     # 仅开发库。生产会拒绝

pnpm dev         # http://127.0.0.1:3000 ，并托管报名站
```

开发库示例账号是 `demo`（管理员）、`exhibitor`（展商）、`user`（普通用户），密码都是 `password`。生产环境不使用这组账号。

`pnpm dev` 会构建并托管报名站，页面源码变化时重新构建。报名站不打进 APK。改报名站页面后刷新浏览器即可。

改了 `src` 里已经被加载的模块之后重启进程。`pnpm dev` 的 tsx watch 会自己重启。不用 watch 起的进程会一直按旧模块应答。

`pnpm dev` 会看护 adb reverse。应用接口是本机地址时，端口来自 `APP_API_BASE`，没配则是 `PORT`。不是本机地址就跳过。规则在 `src/dev/adb-reverse.ts` 开头。服务不是用 `pnpm dev` 起时，自己执行 `adb reverse tcp:<端口> tcp:<端口>`。

## 服务骨架

`package.json` 里是 `"type": "module"`。由此有四条约束：

- 相对导入写扩展名：源文件是 `.ts`，导入写成 `./config/pool.js`。`tsconfig.json` 使用 `moduleResolution: nodenext`。
- 读 JSON 带 `with { type: 'json' }`。
- 没有 `require()`。入口判断在 `src/entry.ts` 的 `isEntry(import.meta.url)`。
- `allowJs` 关闭。未自带类型声明的 CommonJS 依赖在 `src/types/packages.d.ts` 里按实际用到的签名声明。

骨架的层次是安全响应头、CORS、请求日志、JSON 体积守卫、路由、统一错误处理。响应使用 Hono `secureHeaders` 的默认集，不发送 `X-Powered-By`。关掉的探针和未知路径一样是 JSON 404。

报名站打开时，页面回退到 `web/dist-join` 的 `join.html`。`/api`、`/media` 和探针仍是 JSON。配了 `PUBLIC_BASE_URL` 时，只有报名站页面按 Host 做 308。

`src/` 的模块图无环。`config/auth.ts` 只导出纯函数。进程级配置由 `config/env.ts` 的 `loadProcessConfig()` 解析，要用密钥的模块自己去取。

## 依赖取舍

这些是当前决定。换库等于重写，先改这里。

- 数据库用 `pg` 手写 SQL。日期用 `to_char`。事务手写 `BEGIN` / `COMMIT`。迁移在 `config/migrate.ts`。
- 密码用 `bcryptjs`。访问令牌用 `jose`，固定 HS256。刷新令牌是随机串，只存哈希。
- 请求校验用 Zod，类型从 schema 推导。
- 限流、TOTP 和迁移保持自研。登录限流在 `await next()` 之后用 `c.res.clone()` 看信封的 `ok === false`，只记失败。
- 不引入 `hono/compress`。状态页在 `status-page/` 分开维护，构建后运行时仍是单文件 HTML，样式不复用应用的 `tokens.css`。

## 开发模式与生产模式

`pnpm start` 是 `node dist/index.js --production`。`pnpm dev` 留在开发模式。

|                               | `pnpm dev`                | `pnpm start`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `.env` 里的值             | `production`（`--production` 压过 `.env`）                                                                                                                                                                                                                                                                                                                                                                                              |
| `/status` 与 `/api/v1/status` | 打开                      | 关闭，与未知路径同一句 404。需要时 `ENABLE_STATUS_PAGE=true`，并限制来源                                                                                                                                                                                                                                                                                                                                                                |
| `/health`                     | 打开                      | 关闭。需要时 `ENABLE_HEALTH=true`                                                                                                                                                                                                                                                                                                                                                                                                       |
| 浏览器报名站                  | 打开                      | 关闭。需要时 `ENABLE_WEB=true`，且 `web/dist-join` 已经构建                                                                                                                                                                                                                                                                                                                                                                             |
| 启动前配置自检                | 不检查                    | 致命项拒绝启动：开发用的 JWT 密钥、`DB_PASSWORD=postgres`、未配置或仍是示例口令的 `ADMIN_PASSWORD`、`MAIL_TRANSPORT` 为 `console` 或 `memory`、占位或缺失的发件人地址，以及库里仍能用示例口令登录的 `demo` / `exhibitor` / `user`。可疑项只打警告：Mailpit 地址、`CORS_ORIGIN=*`、没配 `TRUST_PROXY`、`LOG_LEVEL=debug`、显式打开状态页或 `/health`、`APP_API_BASE` 不是公网 https、没配 `PRIVACY_POLICY_URL`、配了对外地址但没开报名站 |
| 初始管理员                    | `pnpm db:seed` 的示例账号 | `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`。只在该用户名还不存在时创建                                                                                                                                                                                                                                                                                                                                                         |
| 发信通道                      | 缺省 `console`            | 缺省 `smtp`。`memory` 被拒                                                                                                                                                                                                                                                                                                                                                                                                              |
| 迁移                          | `pnpm db:migrate`         | `pnpm db:migrate:prod`（先打印目标库）                                                                                                                                                                                                                                                                                                                                                                                                  |
| 存活探针                      | `/ping`、`/health`        | 只留 `/ping`。`ENABLE_PING=false` 可关                                                                                                                                                                                                                                                                                                                                                                                                  |

判定在 `src/config/runtime.ts` 的 `resolveRuntime`。启动自检在 `src/config/production.ts`。直接 `tsx src/index.ts`、不带参数，是开发模式。

数据库不可用时进程仍会启动。开发模式下打开 `http://127.0.0.1:3000/status` 可以看到通用失败提示。JSON 探活是 `GET /api/v1/status`。页面源码在 `status-page/`，`pnpm build` 把它内联成单文件。

## 邮件

验证码走 SMTP。生产机出站 25 端口开着时，用本机 Postfix 发信，并配好 SPF 和 DKIM。反解析（PTR）要和发信域名一致，不然对方会拒信或丢进垃圾箱；PTR 不在这台机器上改。出站 25 被封时不要在这台机器上自建，改用托管中继。本地开发仍用 `docker-compose.yml` 里的 Mailpit。

发码次数、冷却、先落库再后台发信、模板里不放链接，写在这三处：

- `src/domain/otp.ts` 开头
- `src/services/mailer.ts`
- `src/services/mail-templates.ts`

本地收件箱是 `docker-compose.yml` 里的 Mailpit。生产自检会拒绝 `console` 和 `memory`，也会警告指向 `127.0.0.1` 的 SMTP。

## 响应约定

前端按这两类判断：

| 情况                            | HTTP      | 响应体                                     |
| ------------------------------- | --------- | ------------------------------------------ |
| 读取成功                        | 200       | 数据本身                                   |
| 写入成功                        | 200       | `{ ok:true, error:'', ... }`               |
| 校验或业务规则失败              | 200       | `{ ok:false, error }`                      |
| 未登录或令牌失效                | 401       | `{ error }`                                |
| 无权或找不到目标                | 403 / 404 | `{ error }`                                |
| 请求体不是合法 JSON，或超过 2MB | 400 / 413 | `{ error }`                                |
| 数据库暂时不可用                | 503       | `{ error:'数据库暂时不可用，请稍后重试' }` |
| 其它服务器内部错误              | 500       | `{ error:'服务器内部错误' }`               |

HTTP 状态码表达认证、授权、可用性和内部故障。业务规则的失败一律 200 + `ok:false`。

写路由用 `mutate()` 收尾（`http/respond.ts`，信封在 `http/envelope.ts`）。它只把 400 / 409 收成信封，401 / 403 / 404 继续上抛。

错误分类在 `src/http/error-response.ts` 的 `statusFor()` / `clientMessage()`。给用户看的只有 `ApiError` 的文案。连接地址、SQL、文件路径和堆栈只进服务端日志。

库故障是 503，不是 500。判定在 `domain/errors.ts` 的 `isDatabaseUnavailable()`：连接失败、驱动的池等待超时，以及 PostgreSQL 的连接类 SQLSTATE。语法错和唯一约束冲突仍按 500 / 409。

`GET /ping` 与 `GET /health` 只回答进程还在不在，不看数据库。连数据库一起判断用 `GET /api/v1/status`。编排里的就绪探针用后者。

## 业务规则

用户可见的能力、状态和额度以 [`docs/product.md`](../docs/product.md) 为准。下面是服务端多出来的口径。

- 报名窗口用数据库 `CURRENT_DATE`。「仅展示 / 截止报名 / 已结束」各有对应提示。
- 收集项校验与 `GET /exhibitions/:id/fields` 是同一份数据。没有配置过就是空数组，不塞默认项。
- 同一用户同一展会只允许一条未撤销的报名，由部分唯一索引和应用层一起拦。唯一冲突不会变成 500。
- 审核状态机在 `routes/review-hono.ts` 的 `REGISTRATION_TRANSITIONS`：待审核可到已通过、已拒绝、已撤销；已通过可到已参加、已拒绝、已撤销；已拒绝可到已通过、已撤销；已撤销可到待审核、已通过；已参加没有后继。越权是 403。白名单之外是 200 + `ok:false`。展商只能改自己举办的展会的报名。审核页只把其中一部分做成按钮。报名者自己撤销走撤销接口。
- 核销走 `/checkin`，不受审核状态机限制。重复核销返回 `duplicated:true`。
- 公开页的报名不含 `checkInCode`。本人和管理员走 `/registrations`、`/review` 时下发。
- 已撤销的报名再撤销一次，是业务失败，不是 500。
- 字符上限取管理员配置的 `limits`。老库缺新键时按默认值补上。
- 密码用 bcrypt。登录时账号不存在也比对一次固定哑哈希。重置密码先校验新密码，通过后才消费验证码。
- 登录和注册的失败限流在 `routes/auth-hono.ts` 的 `authLimiter`。只计失败，成功不计数。计数在进程内存里，多实例部署时换共享存储。
- 验证码的次数、冷却和发码额度在 `src/domain/otp.ts`。发码和验证之间用户名被抢注时返回「已被注册」，不返回 500。
- 刷新令牌的撤销和校验是一条条件更新。同一个刷新令牌并发用两次，只有一个能换到新令牌。
- 受限账号的判定在 `domain/permissions.ts` 的 `isLimited()` / `assertNotLimited()`，文案表是 `LIMITED_ACTIONS`。拦截挂在 `mutate()` 之外，并排在角色检查之前，因此受限的普通用户看到的是「账号已被限制」。管理员不受限。封禁在认证层拒绝。`capabilities` 同步把对应入口置灰。
- `PUT /profile` 只写出现过的字段，不接受 `email`。
- 管理员不能改自己的状态。管理员关闭他人两步验证是对方邮箱不可用时的出口。`enabled:true` 会被拒。
- `PUT /exhibitions/:id/status` 同时接受中文标签和英文代码。
- 私人会议未开放时，申请表单不返回收集项。被限制的会议，主办人改状态得到 403。

## 媒体与配色

容量和格式上限是 `app_settings` 里的 JSON，不是数据库列。默认值和取值范围以 `domain/settings.ts` 的 `DEFAULT_SETTINGS` 为准。越界值由 `applyServerPatch()` 夹到范围内。缺键按默认值补上，新增上限不需要迁移。

`videoSizeMb` 的下限是 1。原生侧 0 会变成不限。头像单文件上限是 `min(upload.avatarSizeMb, UPLOAD_MAX_MB)`，`UPLOAD_MAX_MB` 缺省并封顶 20。封面和简介媒体不走这道 20MB 硬顶，也不走 2MB 的 JSON 体积守卫。

色板定义在 `src/config/migrate.ts` 的 `THEME_COLORS`。`app_settings.theme` 是全局默认。`users.ui_theme` 是个人选择。下标 0 固定为默认色，新色只往后追加。原生 `AppSettings.ACCENTS` 与这里逐位对应。

下发的 `theme.index` 是该调用者实际生效的下标：`users.ui_theme ?? app_settings.theme.index`。`PUT /settings/ui-theme` 越界是 200 + `ok:false`，不夹取。`PUT /settings` 的全局 `themeIndex` 仍按补齐后的色板长度夹取。老库的补色和加列在迁移里。`readServerSettings()` 再用 `normalizeThemeColors()` 兜底。

## 数据模型

- 状态存英文代码。中文标签只在 `src/domain/labels.ts` 映射，与前端的状态词汇是同一批字符串。
- 展会日期只存 `exhibition_date`。年、月、日由 SQL 派生，并用 `to_char` 取成字符串。
- 报名记录不冗余展会标题、时间和地点。读取时 JOIN 展会表。
- 迁移按编号记在 `schema_migrations`，只跑没跑过的步骤。新字段追加新步骤。
- 邮箱大小写无关唯一，空串例外。验证码只存哈希。注册时的待建账号暂存在 `email_codes.payload`。两步验证的预认证票在 `preauth_tickets`。发信留痕在 `mail_log`。
- `refresh_tokens.session_id` 对应 JWT 的 `sid`。远程撤销后，访问令牌也立即失效。服务端只保存设备凭据的哈希。

表结构以迁移脚本为准。

## 探针

- `ok` 只表示进程还在、并且数据库答得上。迁移没跑完和自检失败写在 `checks` 与 `migrations` 里，不进状态码。
- 数据库连不上时，`data` 是 `null`，迁移按全部未应用处理，响应使用通用提示。状态页这一路仍返回 HTTP 200。`/api/v1/status` 返回 503。
- `endpoints` 读取各路由模块导出的注册表，与 `src/test/contract-harness.ts` 的 `backendRoutes()` 同一来源。这两个状态接口本身不进前端动作表。
- 两个路径都带 `Cache-Control: no-store`。服务端在 1.5 秒内复用报告。探测用 `pool.connect()`，超时后 `release(true)` 销毁那条连接。连接池另有 `statement_timeout: 10s`。
- 探针自己出错时走 `fallbackReport()`，返回 `{ ok:false }` 和一条失败的自检项。

## 验证

脚本在 `package.json`。契约测试会自己起一个服务并连接真实数据库，库由 `test/global-setup-contract.ts` 建成的模板克隆而来（每个文件一份干净数据）。字段漂移在这里失败。

数据库不可用这条路径要换端口起一个真进程：`DB_PORT=6543 PORT=3011 npx tsx src/index.ts`。业务接口返回 503，正文不含内网地址和堆栈。`/api/v1/status` 返回 503。`/status` 和 `/ping` 返回 200。
