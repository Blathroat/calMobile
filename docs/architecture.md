# 架构与数据边界

数据只有一处来源：后端 PostgreSQL；业务规则只存在一处：`server/src/domain/`。前端不复制规则，原生不复刻数据。

## 前端架构（WebView 承载 newUI）

前端由 WebView 承载，页面资源位于 `app/src/main/assets/web/`，通过自定义域名映射到 `https://appassets.androidplatform.net/assets/web/`，保持标准 Web 安全上下文（`fetch`、ES 模块、`localStorage` 可用）。

```text
app/src/main/
├── assets/web/
│   ├── index.html              外壳与资源入口
│   ├── styles/tokens.css       newUI 设计令牌（颜色/字号/间距/圆角）
│   ├── styles/motion.css       动效层：页面切换、抽屉、按压、悬浮、状态切换
│   ├── vendor/easymde/         内置 Markdown 编辑器（EasyMDE 2.21.0，MIT）
│   └── js/
│       ├── app.js              路由注册与应用启动
│       ├── core/               bridge.js（原生桥）、router.js（哈希路由与导航）、dom.js、sanitize.js、markdown.js、validate.js
│       │                       api.js（唯一取数入口）、loadable.js（先画缓存）、preload.js（预加载）
│       ├── ui/components.js    顶部栏、卡片、分段控件、头像与裁剪、状态块、弹层、轻提示
│       └── pages/*.js          17 个页面模块，一屏一文件
├── java/com/example/calmobile/
│   ├── WebShellActivity.java   WebView 容器：资源与上传文件拦截、返回栈、结果与权限转发
│   ├── WebAppBridge.java       JavaScript 接口与回调分发
│   ├── WebAppActions.java      动作分发入口，固定 10 个系统动作
│   ├── SystemActions.java      系统日历、通知权限、摄像头权限、设备镜像（`ui.sync`）
│   ├── MediaActions.java       图片选择与落盘、媒体导入、CSV 导出、系统分享
│   ├── CalendarHelper.java     系统日历读写
│   ├── NotificationHelper.java 通知渠道与通知权限查询
│   ├── ExportManager.java      CSV 生成（展会、报名）
│   ├── AppSettings.java        设备侧镜像（外观模式、配色下标、媒体上限、系统栏颜色）
│   ├── FrontendStrings.java / InjectStrings.java  前端文案注入
│   └── CalMobileApp.java       应用入口（通知渠道）
```

上传文件保存在应用私有目录 `files/media`，通过 `https://appassets.androidplatform.net/media/<文件名>` 引用；`WebShellActivity` 只放行该目录下的单层文件名，路径穿越一律拒绝。

桥接协议：前端调用 `CalMobileNative.invoke(action, payloadJson, callbackId)`，原生处理完成后回调 `window.CalMobileBridge.onResult(callbackId, ok, result, error, code)`。前端只使用 `js/core/bridge.js` 的 `call(action, payload)`，异常统一抛出 `Error` 由页面就地展示；`call()` 对不弹系统界面的同步动作（日历、`ui.sync`、`media.store`、`share.text`）带 30 秒兜底超时，原生忘记回调时 promise 会拒绝而不是永久挂起。第 5 个参数 `code` 是稳定错误码（`cancelled` / `timeout`），页面据此判断可预期的失败，不去匹配失败文案。

## 页面与设计稿对照

| 编号 | 页面模块 | 说明 |
| --- | --- | --- |
| 01 | `pages/login.js` | 登录 / 访客入口 |
| 02 | `pages/home.js` | 月视图与当天展会 |
| 03 | `pages/detail.js` | 展会详情、加入日历、分享 |
| 04 | `pages/registration-form.js` | 报名信息 |
| 05 | `pages/register.js` | 创建账号（两步：填资料 → 邮箱验证码，验证通过才建号） |
| — | `pages/forgot-password.js` | 找回密码（邮箱验证码 + 新密码，不占独立设计稿） |
| 06 | `pages/search.js` | 搜索展会 / 地点 / 用户 |
| 07 | `pages/my-registrations.js` | 我的报名 |
| 08 | `pages/registration-detail.js` | 报名详情与撤销 |
| 09 | `pages/profile.js` | 个人主页、头像与设置（含管理员配色） |
| 10 | `pages/exhibitor.js` | 展商后台 |
| 11 | `pages/exhibition-form.js` | 展会编辑（封面上传、报名方式与收集项） |
| 12 | `pages/rich-editor.js` | Markdown 简介编辑（EasyMDE） |
| 13 | `pages/review.js` | 报名管理 / 审核 |
| 14 | `pages/user-public.js` | 用户公开页（入口在管理后台） |
| 15 | `pages/admin.js` | 管理后台（用户 / 展会 / 设置） |
| — | `pages/checkin.js` | 核销报名码（展商后台的现场工具，不占独立设计稿） |

设计稿中的 16「展会管理」与 17「系统设置」不再作为独立页面：搜索、暂停报名与导出 CSV 内联在管理后台的展会分区；启动公告、展会分类、审核策略、媒体与上传限制、字符数上限归入管理后台的「设置」分区（服务器设置，保存后对所有用户生效）；应用配色因为属于个人偏好，保留在个人页的「设置」栏。核销报名码同理，作为展商后台顶部入口的现场工具存在，没有对应的线框屏。

新增页面时同时更新 `assets/web/js/app.js` 的路由注册、本文件的对照表与 `scripts/webui-render.test.js` 的 `ROUTES`；管理类功能优先内联到现有页面，不新增二级页面。

## 架构与数据边界

| 组件 | 职责 |
| --- | --- |
| `server/src/routes/*.ts` | REST 路由：Hono 的 `auth`、`profile`、`bootstrap`、`users`、`search`、`settings`、`exhibitions`、`registrations`、`review`、`checkin`；状态页仍由 `status` 路由提供 |
| `server/src/domain/` | 业务层：状态词汇表（`labels.ts`）、SQL 片段（`queries.ts`）、响应映射（`payloads.ts`）、权限（`permissions.ts`）、校验（`validation.ts`）、设置（`settings.ts`）、会话与令牌（`session.ts`）、错误与信封（`errors.ts` / `respond.ts`） |
| `server/src/config/migrate.ts` | 表结构与示例数据，按编号记录迁移、可反复执行 |
| `js/core/api.js` | 前端唯一取数入口：动作名 → REST 路径的映射表 + 401 自动续期 |
| `js/core/bridge.js` | 只负责启动、文案注入、外观应用与 `ui.sync` 设备镜像 |
| `WebAppActions` + `SystemActions` / `MediaActions` | 10 个系统动作的原生实现：日历、通知与摄像头权限、媒体选择与落盘、分享、CSV 导出、设备镜像 |
| `CalendarHelper` / `NotificationHelper` / `ExportManager` | 系统日历读写、通知渠道与权限、CSV 生成 |
| `AppSettings` | 设备侧镜像（外观模式、配色下标、媒体上限、系统栏颜色），权威值在后端 |

数据只有一处来源：后端 PostgreSQL（表结构见 `server/src/config/migrate.ts`）。原生不再持有任何业务数据实现，后端连不上时应用直接报错并给出排查提示，不做本地降级。

逻辑对象包括：

| 对象 | 主要内容 |
| --- | --- |
| Exhibition | 名称、地点、日期、时间、状态、分类、Markdown 简介、展商 |
| Registration | 展会、报名人、提交时间、审核状态（待审核 / 已通过 / 已拒绝 / 已参加 / 已撤销）、表单回答 |
| RegistrationField | 标题、类型（文本/单选/多选）、选项、必填 |
| User | 昵称、邮箱、简介、地区、头像、角色、账号状态、公开策略 |
| AppSettings | 配色、外观模式、启动公告、分类、审核后是否可修改、媒体与上传限制、字符数上限 |

## 技术选型与权限

Android 依赖只有 `app/build.gradle` 里的 Gson（桥接层 JSON）与 JUnit（单元测试）：界面在 WebView 里，不引入 AndroidX、Room、Retrofit、图片或富文本库。WebView 容器只用平台 API，资源映射由 `WebShellActivity` 自行实现。

前端的第三方运行时依赖全部内置在 `assets/web/vendor/`，不依赖 CDN、图标字体或构建工具，版本与来源记录在各目录的 `VERSION.txt`：

| 目录 | 依赖 | 用途 |
| --- | --- | --- |
| `vendor/easymde/` | EasyMDE 2.21.0（MIT，内置 marked 与 CodeMirror 5） | Markdown 简介编辑器 |
| `vendor/qrcode-generator/` | qrcode-generator 1.4.4（MIT） | 报名码与绑定验证器（`otpauth://`）的二维码 |
| `vendor/jsqr/` | jsQR 1.4.0（Apache-2.0） | 在摄像头画面里识别报名码 |

应用声明 `POST_NOTIFICATIONS`、读写系统日历所需权限，以及核销报名码使用的 `CAMERA`（声明为可选硬件，无摄像头设备仍可手动输入报名码）。首次使用日历、通知或扫码时由前端发起申请，授权后继续执行原操作，拒绝时页面保留可用的浏览与报名流程。`WebShellActivity` 的 `onPermissionRequest` 只放行 `RESOURCE_VIDEO_CAPTURE`，且必须在应用层已获得摄像头权限时才同意。

### 原生界面与 WebView 的取舍

界面只有 WebView 一处入口：`WebShellActivity` 是清单里唯一的 Activity，界面代码全部在 `assets/web`。选择 WebView 的原因是 `docs/newUI/` 交付件本身就是 HTML/CSS，直接复用可保证视觉一致；页面模块化后改动集中在 `assets/web`，无需重新编译 XML 布局。

代价与边界：离线资源由 APK 内置，媒体文件仍保存在设备本地；JavaScript 与 Android 返回栈通过 `history` 与 `WebView.canGoBack()` 同步；文件选择、日历写入、通知权限、CSV 导出和分享通过桥接调用系统界面；简介编辑器使用内置 EasyMDE（Markdown）。

### 界面文案

用户可见文案统一维护在 `app/src/main/res/values/strings_frontend.xml`（574 条），由 `scripts/extract-strings.js` 从 `assets/web/js` 生成，原生在 `onPageStarted` 注入 `window.CalMobileStrings`，前端用 `core/strings.js` 的 `t('key')` 取用。改文案请改前端源码后重跑脚本，再用 `node scripts/check-strings.js` 校验三处（源码、资源、`FrontendStrings.NAMES`）一致——任何一边漏了都会在合入前失败，而不是在界面上静默显示成 key。文案资源**不得以空白开头或结尾**：Android 的 `<string>` 会裁掉首尾空白，靠它做间隔在真机上会粘在一起（该检查会拦下这种写法）。

### 静态资源缓存与按需加载

APK 内的 `.js` / `.css` 由 `WebShellActivity` 以 `Cache-Control: no-cache` 返回（可以缓存，但每次回来校验），HTML 为 `no-store`；用 `max-age` 会出现「新的 index.html 配旧的 js 模块」这种只在升级当天复现的错乱。改动前端后需要重新安装 APK。

EasyMDE、qrcode-generator、jsQR 三个内置库全部改为按需加载（`core/vendor.js`）：它们随 APK 打包不依赖 CDN，但合计约 660KB，启动时全量解析会明显拖慢首帧。

## 前后端边界

页面不直接 `fetch`，**也不直接调用桥接取数据**。数据统一走 `js/core/api.js` 这个唯一入口：

```js
import { exhibitions, registrations } from '../core/api.js';

const items = await exhibitions.list({ query });   // ← 页面只写到这里
const one = await exhibitions.get(id);
await registrations.submit(payload);
```

`api.js` 内部是一张**动作名 → REST 请求**的映射表（`ENDPOINTS`）：按表把动作翻成 `GET/POST/PUT/DELETE /api/v1/...`，带 `Authorization: Bearer`；访问令牌过期（401）时自动用刷新令牌换一次再重试。**没有第二条路径**，原生不再有数据实现，5xx 与连不上都会如实抛出 `TransportError`，由页面把原因（后端地址、`pnpm dev`、`adb reverse` 提示）显示出来。渲染测试里，页面把数据动作交给原生桥接会直接失败。

响应约定：**读取类直接返回数据**（列表、对象）；**写入类返回 `{ ok, error, ... }` 信封**，页面按 `.ok` 判断。状态码只有三种含义：**4xx 是业务/权限问题**（抛出错误由页面提示），**400/409 这类可预期的规则失败**由后端包成 HTTP 200 + `{ ok:false, error }`，**5xx 与连不上**是传输层失败。

`users` / `profile` / `settings` 三个域额外提供 `usersApi` / `profileApi` / `settingsApi` 别名，避免被页面里的同名局部变量遮蔽。

系统能力（摄像头权限、系统日历、分享、媒体选择与落盘、CSV 导出、通知权限、设备镜像）不属于数据接口，仍由页面直接调 `bridge.js`，动作表固定为 10 个。

### 取数体验：先画缓存、再后台刷新

只读接口在 `api.js` 里由 `reader()` 包装，同一个函数有三种用法：

| 用法 | 语义 |
| --- | --- |
| `exhibitions.list(params)` | 取数；缓存新鲜时直接用缓存，不重复请求 |
| `exhibitions.list.peek(params)` | **同步**返回缓存（可以是过期数据），没有再返回 `undefined` |
| `exhibitions.list.warm(params)` | 后台预取，失败静默 |

页面不自己判断「要不要先画骨架屏」，统一交给 `js/core/loadable.js` 的 `loadInto(host, { read, params, render })`：

1. 缓存命中 → **同步**渲染一屏，一个 await 都不等；
2. 缓存没有且容器是空的 → 才画骨架屏（真正的首次加载）；
3. 容器里已有内容时**不清空**，只把旧内容标记 `data-busy` 淡一点；
4. 远端结果回来，内容真的变了才重绘（避免列表入场动画被无谓重放）；
5. **过期响应丢弃**：每次加载领一个自增代号，回来时代号已经不是最新的（用户又切了月份 / 改了搜索词 / 换了分区）就直接丢掉，既不渲染也不碰 `data-busy`——否则先发起的慢请求会覆盖后发起的新视图。

配套的 `js/core/preload.js` 在空闲回调里预取「下一步大概率要看的数据」：底部导航各页（`preloadTabs()`）、当前页面的相邻月份与列表首项详情（`preloadFollowUps()`），以及列表行 `pointerdown` 时就起跑的 `warmOnPress()`。缓存键按参数名排序并忽略空值（见 `api.js` 的 `cacheKey`），预加载与页面取数因此一定能对上；同一份数据的并发请求会去重；首页的预热键**带上落点年月**（`home-2026-9`），所以 bootstrap 下发的落点月份变了会重新预热一次，而不是被首次调用去重掉。

日历卡片另外有一条规则：`exhibitions.month` 一次返回**整月**展会，所以「选中哪一天」完全在本地完成，点日期既不重新取数也不重建日历 DOM。

### 取数失败必须让用户看见

- 不要用 `Promise.allSettled` 吞掉错误后照常渲染；也不要把「未知」显示成「已授权 / 已开启」。
- 页面不要自己 `catch` 后画错误块：错误块由 `loadInto()` 统一处理。
- 后端连不上就直接报错，没有原生降级路径（数据只在后端）。

## 后端与连通性

后端是 `server/` 里的 Hono + PostgreSQL 服务，接口按 REST 组织，路径与前端 `api.js` 的动作一一对应（映射表在 `js/core/api.js` 的 `ENDPOINTS`）。服务骨架（公共层、探针、统一错误处理）在 `src/server/`；认证、资料与安全、展会、报名、审核、核销路由直接运行在 Hono 上，尚未迁完的部分仍由 `src/server/express-app.ts` 的 Express 应用代答，迁移计划见 `docs/roadmap.md`，取舍见 `docs/adr/0001-server-hono-typescript.md`。

```bash
# 1. 起数据库与本地收件箱（Docker 容器 calmobile-pg / calmobile-mail）
docker compose up -d

# 2. 建表 + 示例数据（可反复执行）
cd server && pnpm install
cp .env.example .env                # 按需改数据库连接与 JWT 密钥
pnpm db:migrate && pnpm db:seed
pnpm dev                         # 开发模式（tsx watch），http://127.0.0.1:3000

# 3. 真机 / 模拟器访问本机后端
adb reverse tcp:3000 tcp:3000
```

**`pnpm dev` 与 `pnpm start` 是两种模式**：`dev` 走开发模式（状态页开着、不做启动自检）；`start` 自动进**生产模式**（`node dist/index.js --production`）——关掉 `/status` 与 `/api/v1/status`、对配置做启动前自检（开发密钥、默认库密码、验证码只写日志这类致命项直接拒绝启动），对生产库迁移用 `pnpm db:migrate:prod`。判定集中在 `server/src/config/runtime.ts`，细节见 `server/README.md`。

示例账号 `demo` / `exhibitor` / `user`，密码都是 `password`（角色分别是管理员、展商、普通用户）。

后端**启动时不要求数据库可用**：连不上库时会在日志里给出警告并照常监听端口，`/status` 健康页会把这些检查项标红，方便先排查连接再处理业务。数据库跑在 Docker 里（根目录 `docker-compose.yml` 的 `db` 服务：容器 `calmobile-pg` + 命名卷 `calmobile-pgdata`），`server/.env` 不用改；容器**必须带时区参数**（compose 里已配 `Asia/Shanghai`）：镜像默认 UTC，而数据库的 `CURRENT_DATE` 决定报名窗口与日历落点，不设的话本机凌晨那段时间会莫名差一天。

**改了 `server/src/*.ts` 要重启进程**：Node 会缓存已加载的模块，旧进程会继续按改之前的逻辑应答。

细节见 `server/README.md`；`server/src/test/api.test.ts` 是前后端契约与接口测试，逐接口断言页面真正用到的字段都在、权限与业务规则都拦得住，字段漂移会在这里失败而不是静默渲染成空。

### 原生只剩 10 个系统动作

`WebAppActions.handle()` 的 switch 就是权威清单，数据动作一律不在其中：

| 动作 | 用途 |
| --- | --- |
| `ui.sync` | 把外观模式、配色下标推给原生，并取回设备事实（通知授权状态） |
| `camera.ensurePermission` | 扫码前申请摄像头权限 |
| `calendar.status` / `calendar.toggle` | 系统日历里是否已存在该展会、加入或移除（按后端下发的 ISO 日期定位，失败如实报错，不假装成功） |
| `notify.requestPermission` | 申请通知权限（通知本身由后端落库，不做本地推送） |
| `media.pickImage` | 系统图片选择器 |
| `media.import` / `media.store` | 压缩后写入 `files/media` 并返回短 URL |
| `share.text` | 系统分享面板 |
| `export.csv` | 弹系统保存对话框写出 CSV（展会、报名两组数据，文件名带时间戳） |

其余全部是 HTTP：`bootstrap`、认证、资料、展会、报名、审核、核销、用户、搜索、设置、通知偏好共 50 个数据动作，由 `api.js` 的 `ENDPOINTS` 映射到 `server/` 的 REST 路由。

### 数据落在哪

业务数据只有一处来源：后端 PostgreSQL，表结构在 `server/src/config/migrate.ts`（迁移按编号记录，可反复执行）——`users` / `exhibitions` / `exhibition_fields` / `registrations` / `app_settings` / `notification_preferences` / `refresh_tokens` / `notifications` / `email_codes` / `preauth_tickets` / `mail_log` / `schema_migrations`。展会扩展字段、收集项、审核状态与核销时间都有正式的列。

**仍然只在客户端**的只有两类：

| 数据 | 存放位置 | 说明 |
| --- | --- | --- |
| 上传的媒体 | 应用私有目录 `files/media` | 需要对象存储与上传接口；现在用 `appassets.androidplatform.net/media/<文件名>` 短 URL 引用 |
| 设备事实 | `AppSettings`（SharedPreferences） | 外观模式与配色的本地镜像、日历与通知权限；权威值在后端（`users.ui_mode`、`app_settings`） |

### `server/` 端点与前端动作的对应

健康与状态页：`GET /ping`、`GET /health`，以及给人看的 `GET /status` 与机器读的 `GET /api/v1/status`（这两个**在生产模式下默认关闭**，见 `deployment.md` 的「上线部署清单与开销」）。`/status` 首屏由服务端直接渲染，浏览器脚本每 5 秒局部刷新；两条路径共用探测报告，服务端对紧邻请求做 1.5 秒短缓存。其余都在 `/api/v1` 下。完整清单（含请求参数、权限与响应形状）见 `server/README.md` 的「接口清单」，这里只列骨架：

| 已有路由 | 对应前端动作 |
| --- | --- |
| `GET /api/v1/bootstrap` | `bootstrap`（一次拉取用户态 + 全部配置） |
| `POST /api/v1/auth/login`、`/login/verify`、`/login/code` | `auth.login`（开了两步验证时只回票）、`auth.loginVerify`、`auth.loginCode` |
| `POST /api/v1/auth/register`、`/register/verify` | `auth.register`（只发码，不建号）、`auth.registerVerify` |
| `POST /api/v1/auth/password/forgot`、`/password/reset` | `auth.forgotPassword`、`auth.resetPassword` |
| `POST /api/v1/auth/guest`、`/logout`、`/refresh` | `auth.guest`、`auth.logout`；`/refresh` 是令牌轮换，没有独立动作 |
| `GET\|PUT /api/v1/profile`、`POST /profile/password`、`GET\|PUT /profile/notifications` | `profile.get`、`profile.save`、`profile.password`、`notify.preferences`、`notify.savePreferences` |
| `GET /api/v1/profile/security`、`POST /profile/2fa/enable`、`/2fa/enable/verify`、`/2fa/totp/setup`、`/2fa/totp/enable`、`/2fa/backup-codes`、`/2fa/disable` | `security.get`、`security.enable2fa`、`security.verify2fa`、`security.totpSetup`、`security.totpEnable`、`security.backupCodes`、`security.disable2fa` |
| `POST /api/v1/profile/email`、`/email/verify` | `security.changeEmail`、`security.verifyEmail` |
| `GET /api/v1/exhibitions`、`/month`、`/categories`、`/:id`、`/:id/fields` | `exhibitions.list`、`exhibitions.month`、`exhibitions.categories`、`exhibitions.get`、`exhibitions.fields` |
| `POST /api/v1/exhibitions`、`PUT\|DELETE /:id`、`PUT /:id/status`、`PUT /:id/fields` | `exhibitions.save`、`exhibitions.delete`、`exhibitions.status`、`exhibitions.saveFields` |
| `GET\|POST /api/v1/registrations`、`GET\|DELETE /:id` | `registrations.list`、`registrations.get`、`registrations.submit`、`registrations.cancel` |
| `GET /api/v1/review`、`GET /:id`、`PUT /:id/status` | `review.list`、`review.get`、`review.updateStatus` |
| `POST /api/v1/checkin` | `checkin.scan`（现场核销） |
| `GET /api/v1/users`、`/:id`、`PUT /:id/status`、`PUT /:id/two-factor`、`GET /users/public` | `users.list`、`users.get`、`users.status`、`users.disable2fa`、`users.public` |
| `GET /api/v1/search` | `search.query` |
| `GET\|PUT /api/v1/settings`、`PUT /settings/ui-mode` | `settings.get`、`settings.save`、`settings.uiMode` |

前端动作名与这些路径的映射写在 `js/core/api.js` 的 `ENDPOINTS` 表里，新增接口要同时改那张表、后端路由与 `server/src/test/api.test.ts`（那里有前后端路由交叉校验，多一条少一条都会失败）。

### 月视图与日历落点（已固定的两处契约）

| 约定 | 说明 |
| --- | --- |
| `exhibitions.month` 的参数只有 `year` / `month`（`day` 可选，用于深链定位初始选中日期） | 参数形状固定，前端与预加载才发得出同一个缓存键 |
| 请求哪个月就返回哪个月 | 空月份返回 `eventDays: []`、`day: 0`，不会悄悄换成有展会的月份 |
| 首次打开看哪个月由 `bootstrap` 的 `calendar.landing = { year, month }` 决定 | 落点规则属于「界面先给用户看什么」，不属于月视图接口；`exhibitions.month` 因此不需要 `explicit` 参数 |
| 选中日期由前端本地决定 | 月视图一次返回整月数据，点日期不往返请求 |

后端的示例展会日期是**相对今天**生成的（`db:seed` 用 `CURRENT_DATE + N days`），因此日历落点、报名窗口这些与「今天」有关的规则永远有可演示的数据。
