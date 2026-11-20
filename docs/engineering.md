# 工程边界与界面实现

本文件是客户端、前后端边界和界面实现规则的来源。用户可见行为见 [`product.md`](product.md)。响应约定、服务端规则和数据模型见 [`server/README.md`](../server/README.md)。接口路径以各路由模块的注册表和 `web/api-endpoints.mjs` 为准。

全局样式按层叠顺序拆在四个文件里：`web/src/styles/tokens.css`（只放设计变量与明暗模式）、`base.css`（重置与外壳/容器/排版原语）、`components.css`（通用控件：按钮、输入、卡片、面板、标签等）、`special.css`（专属组件与 iOS/PWA 适配）；动效在 `web/src/styles/motion.css`。`web/src/main.ts` 与 `web/src/join/main.ts` 按 tokens → base → components → special → 组件样式 → motion 的顺序 import，**不要调换**。只被一个组件使用的样式写在该组件的 `<style>` 里，不加 `scoped`：选择器保持全局，不依赖父子组件的渲染边界。

## 系统边界

业务数据只存在 `server/` 的 PostgreSQL。前端经 `web/src/api/client.ts` 访问。原生只做设备能力。后端不可用时页面报错。

同一份 `web/dist` 同时服务 Android WebView 与 iPhone 主屏幕应用（PWA）：站点上都在 `/app/`，原生壳拦截到本机快照，Safari 与主屏幕应用直接加载线上这份产物。没有原生桥时，设备能力改用浏览器实现，见「iPhone / PWA」的「设备能力」。

| 层           | 责任                                              | 权威入口                                                  |
|--------------|---------------------------------------------------|-----------------------------------------------------------|
| WebView 页面 | 路由、渲染、表单和用户交互                        | `web/src/`（构建到 `web/dist`，包内一份，正式包再用本机快照；iPhone 主屏幕应用加载同一份产物） |
| 前端数据     | 类型化 REST client、令牌续期、缓存                | `web/src/api/client.ts`；契约表为 `web/api-endpoints.mjs` |
| 前端加载     | 缓存首屏、后台刷新、错误呈现                      | Vue composable 与 `web/src/services/query-cache.ts`       |
| 设备能力     | 原生：系统日历、通知权限、摄像头、媒体、分享、CSV、设备镜像；浏览器：文件选择、下载、Web Share、通知权限 | `web/src/services/device-services.ts`（原生动作表 `WebAppActions.handle()` / 浏览器实现 `browser-device.ts`） |
| 后端         | 认证、业务规则、持久化、邮件和接口                | `server/src/`                                             |

页面不直接 `fetch`，也不通过原生桥接取业务数据。读取接口直接返回数据。写接口按响应约定返回信封。

操作日志由服务端 `server/src/services/logs.ts` 在响应之后异步写入 `app_logs`：变更请求（非 GET）、4xx / 5xx、以及登录 / 注册 / 找回密码这类认证接口无论成功失败都记一条；读接口成功不记，不记录请求体（只留方法、路径、状态码、耗时、操作人与 IP）。写日志是旁路，失败只进服务端控制台，不影响请求本身。超过 `app_settings.logs.storageMb` 时按累计大小清理最早的记录（写入后节流清理，管理员调小上限时立刻清一次）。管理页 `/logs` 是通过 `GET /api/v1/logs` 读取的最近日志，仅管理员可见；入口按钮放在「管理-设置 → 日志」卡片内部、设置项下方（整行浅色描边按钮，`cta ghost`）；`AdminSettingsSection` 发 `open-logs` 事件，`AdminPage` 负责跳转，不在管理页顶部。

客户端地址由 `server/src/http/client-ip.ts` 统一解析：`TRUST_PROXY` 决定怎么读 `X-Forwarded-For`（跳数或可信来源），`TRUST_CLOUDFLARE` 打开时，只要地址链里经过可信反代就改用 Cloudflare 写入的 `CF-Connecting-IP`。登录 / 注册、验证码限流、请求日志与操作日志都走这一个函数；登录成功时 `recordLogin()` 每次刷新 `last_login_time` / `last_login_ip` / `last_login_region`，地区由 `services/ip-region.ts` 用离线 xdb 解析，IP 原文只落库、不下发。

正式包的文档地址是 `APP_API_BASE` 所在源的 `/app/index.html`。WebView 拦截 `/app/`，从本机快照读文件；还没有快照，或快照不是当前 `versionCode` 时，用 APK 里的那份。页面切换不再请求网络。首屏出来之后才在后台拉取 `/app/release.json`，新文件留到下次冷启动再换上。调试包（接口是 http）不热更新。只有 `/app/index.html` 能调用 `CalMobileNative`，其它链接交给系统浏览器。设备上选中、尚未上传的媒体仍从 `https://appassets.androidplatform.net/media/` 读取。页面要先 fetch 这份地址再上传，所以这份响应带上 `Access-Control-Allow-Origin`，值是页面文档的源。

`/app/` 同时是 iPhone 主屏幕应用的入口：Safari 打开的也是这份产物，Web App Manifest、Service Worker 与安装图标在构建时生成，缓存边界见「iPhone / PWA」。`release.json` 只服务 Android 热更新，不进 Service Worker 缓存。

新接口同时改 `web/src/api/client.ts`、`web/api-endpoints.mjs`、后端路由和 `server/src/test/` 下的契约测试（前端动作总数在 `routes-contract.test.ts` 里钉成常量，加接口要一起改）。

### 通行密钥与更新检查

- 两步验证的通行密钥走 WebAuthn：服务端用 `@simplewebauthn/server` 生成选项并校验结果（挑战存 `webauthn_challenges`、凭据存 `passkey_credentials`）；前端 `web/src/services/webauthn.ts` 只用浏览器原生 `navigator.credentials`，自己负责 base64url ↔ ArrayBuffer 的转换，不引客户端库。绑定需要身份复核票；环境不支持 WebAuthn 时页面隐藏添加入口并说明原因。**只有用户取消才返回 `null`**：原生回包解析不出来、旧壳没有 `passkey.*` 而 WebView 又没有 WebAuthn 时抛出可读中文，页面显示原因，不能静默关掉抽屉。
- 原生通行密钥的边界按「不信任输入、不漏 Throwable」实现（否则主线程异常就是一次闪退）：`WebAppBridge` 的 `invoke` / `dispatch` / `respond` / `onActivityResult` / `onPermissionResult`，以及 `PasskeyActions` 的同步入口与 Credential Manager 的 `onResult` / `onError` 回调全部 catch `Throwable`；回调用 `OneShot` 只认第一次，避免系统重复回调写回两次。选项 JSON 进系统前先校验（空 / 超长 / 非对象 / 缺 challenge、rp.id、user.id、user.name、pubKeyCredParams、rpId 都在本地挡下并给中文说明）。`passkey.available` 按 androidx.credentials 1.3.0 的 provider 选择规则真实判断：API 34+ 看系统 `credential` 服务、缺席时退回 Play 服务提供方，API 33 及以下要求 GMS 版本 ≥ `230815045` —— `CredentialManager.create()` 只是拿到门面对象，不能当作可用。`respond` 拼回页面脚本时 callbackId 里的换行与 U+2028 / U+2029 必须转义，否则整段脚本变成语法错误、页面永远等不到回调。`POST /profile/2fa/passkey/enable` 在账号还没有备用码时顺手生成一批并在响应里返回 `backupCodes`（页面切到「抄下来」那一步展示一次）；已有备用码时不轮换，响应里是空数组。安全页按 `backupCodesLeft` 决定提示：0 枚给警告、动作文案换成「生成备用码」，≤2 枚提醒重新生成。
- 应用版本在构建期由 `scripts/client-target.mjs` 注入成 `__APP_VERSION__` / `__APP_VERSION_CODE__`（App 与报名站两份构建都注入；env 读取在 `scripts/env-file.mjs`），与服务端解析出的最新版本比较。`GET /app/release` 公开、`no-store`，GitHub 源由服务端带缓存地读 Release API（不受浏览器 CORS 与额度限制影响）。
- 「下载并安装」只是打开下载地址：应用里除 `/app/` 之外的链接交给系统浏览器，安装由系统完成，不需要新的原生权限或桥接动作。
- 报名站的下载 / 安装入口在应用外壳的顶栏右侧（`App.vue` 的 `#app-top-actions` 旁的一颗 `icon-button`），条件是「报名站构建 + 没有原生桥 +（iOS 或管理员配了下载地址）」，常驻不可关闭（报名站本身不完整，用户随时要能找到下载入口）；不再单独渲染一条下载横幅。自动检查更新是设备级偏好，存在本机 `calmobile.autoUpdate`。表单校验走 `web/src/services/validate.ts`，上限取 `useBootstrapStore().limits`。后端再校验一次。

角色由服务端判定。展商身份可以按天发放（`users.exhibitor_expires_at`，NULL 表示永久）：到期在服务端认证解析时惰性结算成普通用户，页面只读后端下发的有效角色、`exhibitorExpiresAt` 与 `exhibitorExpired` 做展示，不自己算过期，也不在页面里另写一套续期规则。

## 应用外壳

外壳在 `web/src/app/App.vue`：`.app` 网格是顶栏、可滚动的内容区和底部导航（或页面页脚）。页面只往内容区放内容。

- 顶栏标题、返回键、底部导航项与内容区密度都由路由 `meta` 决定（`title` / `back` / `tab` / `bodyGap` / `bodyPad` / `bodyAlign` / `queryInPlace`）。导航项按角色过滤（`web/src/app/shell.ts`）。
- 页面级顶栏操作写在 `meta.topAction`（`{ icon, to, label }`，或 `{ icon, label, action: 'logout' }`）。外壳据此渲染右上角图标按钮。页面也可以把额外的顶栏按钮 `Teleport` 到 `#app-top-actions`（详情页的分享 / 编辑入口就是这样，模板顺序决定从左到右的顺序）。
- 报名站的下载 / 安装入口是外壳顶栏上的一颗 `icon-button`（见 `App.vue` 的 `showDownloadEntry` / `onDownloadAction`），不再单独渲染一条悬浮横幅；iOS 点开安装说明，其它平台打开管理员配置的下载地址。
- 展会详情页里，`canManageExhibition()` 为真的管理员 / 展商创建者会多一颗编辑铅笔（在分享按钮左边），直达 `/exhibition-form/:id`；报名站没有编辑页，所以那里不渲染。
- 固定操作区用 `<Teleport defer to="#app-foot">` 投递 `.page-foot`，落在网格第三行。`defer` 让目标元素与页面在同一次渲染里创建时也能找到。入口页是例外：注册和忘记密码两个文字入口跟在表单后面随内容滚动，不占页脚槽。
- 页面不自建 `.page` / `.topbar` / `.app-body` / `.tabbar`，也不写颜色、字号、间距与圆角。
- 内容区的左右内距由外壳给两道（`.app-body` 与路由容器 `.page-surface` 各 `var(--s4)`，合计 24px）。页面不再加左右内距。通栏页面用路由 `meta.bodyPad: 'none'`，两道一起去掉。
- 底部面板走 `web/src/services/sheet.ts`。一句话加按钮用 `title` / `message` / `actions`。带输入框或列表的用 `component` + `props`。选项多于两个时 `layout: 'stack'`。会议详情用 `layout: 'close-below'`，关闭独占下一行。`dismissible: false` 时点遮罩与 Escape 都不关闭，只用于用户协议更新确认这类必须做选择的提示。个人页与用户设置的「编辑资料」共用 `web/src/services/profile-editor.ts`。
- 用户协议更新确认走 `web/src/services/agreement-prompt.ts`：外壳（`app/App.vue`）在「已登录 + 协议开启 + 当前版本高于 `user.agreedTermsVersion`」时打开 `dismissible: false` 的抽屉（点遮罩与 Escape 都关不掉，见 `sheet.ts`），按钮是「查看用户协议 / 不同意并退出（`device.exitApp()`）/ 同意（写 `POST /profile/agreement` 后重拉启动数据）」。协议浏览页本身不叠弹窗，从协议页回来仍未同意会重新弹。
- 列表型页面的分区和筛选写进地址栏（`?tab=`），从二级页返回时才能回到同一分区。
- 切换方向由 `web/src/app/navigation.ts` 算出。二级页按路径深度写 `.app[data-direction]`（前进 / 后退 / 原地替换）。底部导航之间按导航顺序写 `.app[data-tab-move]`。`motion.css` 据此选过渡。冷启动的第一次跳转按原地替换处理，首帧静态落地。
- 入口 `/` 恒 redirect `/home`：未登录首帧就以访客态落在首页，不再先画登录页；需要登录的页面由守卫跳 `/login?redirect=<原地址>`，登录页只在需要登录时出现。整页重载时会话恢复的等待只发生在 `meta.requiresAuth` 的页面与直接停在 `/login` 的情况；`main.ts` 只负责把「已登录却停在 `/login`（或 `/` 还没落定）」的一屏替换到 `redirect` 或首页。
- 标签页之间的过渡只位移、不淡入。淡入期间新页面还是透明的，露出来的是外壳背景，浅色模式下会闪一下白。同一屏只换 query 时方向信号保持不动，否则动画名会被换成淡入。
- 页面自己 `watch` query 完成切换的，在 `meta` 里声明 `queryInPlace: true`。外壳改用 `path` 作键，分区切换不重建页面，并预热那几个分区的读接口。
- 明暗模式与强调色在 `web/src/app/theme.ts` 落到 `<html data-mode>` 与 `--accent*`。`data-mode` **始终有值**：`auto` 也写解析后的 `light` / `dark`，不再删属性把明暗交给 CSS media query。系统深浅色在 Android WebView 里不可靠（Activity 是 Light 主题、`configChanges` 含 `uiMode` 后不会重建），所以原生壳用同步接口 `window.CalMobileNative.systemAppearance()`（返回 `{ systemDark, mode }`，`systemDark` 来自 `Configuration.uiMode`）回答首帧；配置变化时 `WebShellActivity.onConfigurationChanged` 重画系统栏 / 容器 / WebView 底色，再 `evaluateJavascript` 调 `window.CalMobileWeb.appearance(...)` 推给页面，页面只在账号 mode 为 `auto` 时跟随。浏览器 / PWA 与没有同步接口的旧壳退回 `matchMedia`。首帧仍由 `index.html` 的内联脚本落一次（先读本机缓存的显式选择，没有就问原生同步接口，再退回 matchMedia），不闪白。用户自己的明暗模式与强调色是账号偏好（`users.ui_mode` / `users.ui_theme`，经 `PUT /settings/ui-mode`、`PUT /settings/ui-theme` 保存）。本机只缓存一份供首帧使用。切换走 `web/src/app/preferences.ts`：本地先生效，落库失败回滚。`app_settings.theme` 只提供默认色板与全局默认下标。
- 深色下的强调色衍生值必须保证可读：`--accent-ink` 往**白**混到在页面底色上 ≥4.5:1（往底色混只会越混越暗），`--accent-edge` 混到 ≥3:1；浅色模式仍往黑白混、视觉不变。**不要把 `--on-dark` 当强调色底上的文字**：`--on-dark` 只给底色反转的浮层（深色模式下 toast 变浅底、文字变近黑）。强调色底上的文字用 `--on-accent`、灯箱与媒体遮罩上的文字用 `--on-media`，两者在两套主题下都是白色；主按钮悬浮色是 `--accent-hover`（深色下把强调色压暗，白字仍可读）。对比度回归见 `web/src/app/theme.test.ts`。

新的应用页面在 `web/src/app/router.ts` 注册（`meta.title` / `back` / `tab`），并更新 `web/src/app/shell.test.ts` 的 `ROUTES`。报名站不写入 `ROUTES`。实现和产品行为冲突时，未决项写入 [`product.md`](product.md) 的待裁决项。

## 浏览器报名站

报名站是第二份构建：`web/join.html` 经 `web/vite.join.config.ts` 输出到 `web/dist-join`，由后端托管，不进 APK。`VITE_SURFACE=join` 只由这份配置注入，不写进 `web/.env`。是否托管见 [`server/README.md`](../server/README.md) 的模式表。

应用用 hash 路由。应用页面、PWA、报名站都与 API 同源，接口和媒体一律用相对路径 `/api/v1`、`/media/...`；页面包不写域名，因此同一份 `web/dist` 可以放到任意 `PUBLIC_BASE_URL` 下部署。`web/check-page-bundle.mjs` 是 Vite 构建插件（`vite.config.ts` / `vite.join.config.ts` 的 `writeBundle` 与 `closeBundle`，`--watch` 每次重建也跑），扫描产物出现 `APP_API_BASE`、`VITE_API_BASE` 或绝对 `/api/v1` 地址就让构建失败。本地 `vite dev` 由 `web/vite.config.ts` 把 `/api`、`/media` 代理到 `APP_API_BASE` 所在的源；Android WebView 的文档地址是接口所在源的 `/app/index.html`，相对路径同样落在那个源。`APP_API_BASE` 只用于 APK 外壳和开发代理，不再注入页面，也不影响运行时包里的页面产物。报名站用 history 路由；它不预取月历、展会列表、资料和管理数据。界面文案在 `web/src/i18n/zh.json`，两份构建各自打包。用户安装的语言包在本机，不在这两份包里。

路径以报名站路由和 `web/src/app/surface.ts` 为准。声明顺序就是匹配顺序，更具体的路径写在前面。

分享链接的分层：

- `/e/:id`：展会详情，公开（未登录也能看）。底部只有「立即报名」，没有「加入日历」；点展商卡片要求登录（跳 `/login?redirect=/u/<昵称>`）。
- `/e/:id/register`：报名信息页，公开。未登录时按匿名报名：收集项里若有标题命中 `bootstrap.registration.nameFieldTitles`（管理-设置「报名相关」，默认 姓名 / 昵称 / 称呼 / 圈名，空数组表示不合并）的文本项，就用它当姓名、不再单列姓名输入，并在匿名模式下按必填校验；没有命中时收集项上方多一项必填「昵称」（上限取 `limits.nickname`，兜底 20）。应用内与已登录的报名站用户仍按账号报名。
- `/e/:id/status`：报名状态页，公开，凭据在 `?token=`。按公开接口取数，并展示查询链接、复制按钮与「必须保存」提示；未登录页脚是「登录 / 注册」（带 `redirect` 回本页），已登录打开时先 `claim` 再 `replace` 到 `/mine/:id`。
- `/u/:nickname`：用户公开页，`requiresAuth`。`/`、`/mine`、`/mine/:id`、`/m/:id` 保持原来的登录要求。
- `/agreement`：用户协议浏览页，公开（登录/注册页的协议蓝链与更新提示都会用到它）；应用与报名站两种构建共用同一页。

守卫只在**已登录**时判 `roles` 与 `capability`：访客的用户态由后端下发 `can.register = false`，照着判会把免登录报名表单挡回登录页。访客能否报名由详情页按展会状态决定，服务端再兜一层。

匿名报名与认领（服务端约定见 [`server/README.md`](../server/README.md)）：

- 编辑展会页把「参与方式（仅通过审核用户可见）」放进「活动信息」卡（在简介的 Markdown 编辑入口之后）：`registrationNotice`（最多 2000 字），随展会保存；服务端 `exhibitionInputSchema` 再校验一次。`GET /registrations/:id` 的 payload 里 `exhibitionNotice` 只在报名状态为 `approved` / `attended` 时下发正文，其它状态是空串，页面据此渲染注意事项卡片。

只有「报名站 + 未登录」才匿名：提交时不带 `Authorization`，服务端记 `visitor_id = NULL`、`visitor_type = 'guest'`、姓名必填。匿名提交响应里的 `queryToken`（32 字节 base64url）只出现这一次，库里只存 sha256（`registrations.query_token_hash`，唯一部分索引）；`GET /registrations/query/:token` 按哈希匹配，返回与本人报名详情同形（含报名码）。
- 未登录时查询链接是唯一凭据（等同身份），所以状态页要提示保存、不要转发；`queryByToken` 刻意不进查询缓存，避免把凭据写进缓存键。
- 已登录打开凭据链接时调 `POST /registrations/claim`：只补 `visitor_id`（保留匿名报名时填的姓名与 `visitor_type = 'guest'`），同账号幂等；被别的账号认领、或与账号已有同展会报名冲突（唯一部分索引）时返回 200 + `ok:false` 文案，页面留在状态页显示原因。
- 带 `Authorization` 但令牌无效时匿名报名接口仍返回 401，不降级成匿名：否则应用内访问令牌过期后提交会悄悄写成无主记录。应用内报名流程与展示不变。
- 多天展会的「参加时间」：报名信息页在姓名之后、收集项之前给两个日期触发按钮，走 `openDateRange` 并同时传 `min` / `max`（开展～闭展）；默认整段展期，可改窄或清除。提交带 `attendanceStart` / `attendanceEnd`（两端都给或都不给），服务端 `server/src/domain/registration-attendance.ts` 校验格式、顺序与展会区间（错误码 `registration.attendance*`），落在 `registrations.attendance_start` / `attendance_end`（NULL 表示没选、按整段处理）。报名详情与展商审核详情显示「参加时间」；`GET /exhibitions/month` 的 `markedDays` 对已通过 / 已参加的报名按这段区间打点。

## iPhone / PWA

iPhone 没有 APK，完整应用以 PWA 方式安装：Safari 打开 `{站点}/app/`，分享 →「添加到主屏幕」。页面代码不按平台分叉业务逻辑：是否使用原生桥由 `nativeBridge.hasNative()` 判断，安装引导用 `web/src/services/platform.ts` 的 iOS / Android / 内置浏览器 / 主屏幕判断（见下），两边共用同一套路由、页面与数据层。

### 安装元信息与构建

- 安装元信息在构建期生成默认值：`web/pwa-build.mjs` 读 `web/src/i18n/zh.json`，在 `web/vite.config.ts` 的构建钩子里写出 `web/dist/manifest.webmanifest` 与 `web/dist/sw.js`；`web/public/icons/` 由 Vite 拷到 `web/dist/icons/`，manifest 里的 `src` 是相对 manifest 的 `icons/…`。部署后服务器会按 `/etc/calmobile.env` 的运行时品牌再生成一份实例页面层（见 `server/src/server/runtime-web.ts`）：它在临时目录复制页面、改标题/manifest/图标、重写 SW 缓存名并重算 `release.json`，不改 `web/dist`。没有品牌变量时不生成，直接托管构建产物。
- 站点 favicon、PWA 图标和 Android 启动图标共用一份源图：`web/pwa-build.mjs` 与 Gradle 的 `buildIcons` 任务都调 `scripts/build-icons.mjs`（只是 façade：PNG 编解码、配置、站点图标、Android 图标分别在 `scripts/icons/` 的 `png.mjs` / `config.mjs` / `web.mjs` / `android.mjs`），把 `APP_ICON`（默认 `web/public/icons/icon-1024.png`）生成到 `web/dist/favicon.ico`、`web/dist/icons/`；Gradle 用同一套模块生成 `app/build/generated/icons/res/`，再作为额外资源目录参与打包，所以各密度启动图标不入库。`APP_ICON_BACKGROUND`（默认 `#41707e`）是 maskable、Apple 主屏幕和 Android 自适应图标的留白底色；`APP_ICON_TRANSPARENT=1` 时站点/PWA 与 Android legacy/round 图标不铺底，Android 也不再生成 adaptive 图标。源图只接受 8 位 RGB/RGBA、非隔行 PNG，非方形会居中裁切。`favicon.ico` 含 16/32/48 三个 PNG 条目；Android 生成 legacy / round / adaptive foreground 三套资源。开发服务器用 `web/public/favicon.ico` 的默认图，生产构建会把生成图写进 `dist`；服务端根路径 `/favicon.ico` 转发同一份产物。服务器运行时可改用 `PWA_ICON_DIR` 指向预生成的一套图标。
- `/app/` 的页面根目录优先取 `web/dist`；运行时包还会把同一份产物复制到 `server/dist/app-shell`，`server/src/server/app-shell.ts` 的 `defaultPackagedAppRoot()` 是副本位置；报名站对应 `server/dist/app-shell-join`（`defaultPackagedJoinRoot()`）。生产 systemd 可能在启动前清掉 `current/web/dist` 或 `web/dist-join`（旧单元把它们当缓存），服务端在构建产物缺失时自动退到副本；部署单元仍不应主动删除它们，见 [`operations.md`](operations.md)。
- `manifest.webmanifest` 的 `name` 取 `app.documentTitle`，`short_name` 取 `pwa.manifest.shortName`，`description` 取 `pwa.manifest.description`；`id` / `start_url` / `scope` 都是 `/app/`，`display: standalone`，`lang: zh-CN`，主题色与背景色取浅色板面。构建期环境变量 `PWA_APP_NAME` / `PWA_APP_SHORT_NAME` / `PWA_APP_DESCRIPTION` 可覆盖默认值（来自 Vite 读的 `web/.env*` 或构建进程环境）；服务器运行期读 `/etc/calmobile.env` 的同名变量，优先级更高，还支持 `APP_TITLE` / `JOIN_TITLE` / `PWA_LANG` / `PWA_THEME_COLOR` / `PWA_BACKGROUND_COLOR`。解析后 `name` / `short_name` / `description` 任一为空（`zh.json` 缺键、也没给对应 `PWA_*`）就直接构建失败；`short_name` 为空时先回落 `pwa.manifest.shortName`，再回落 `name`。
- `web/index.html` 里的 `%APP_TITLE%` / `%PWA_SHORT_NAME%` / `%PWA_DESCRIPTION%` 由同一个脚本替换，Apple 主屏幕标题（`apple-mobile-web-app-title`）用同一份 `short_name`；`join.html` 只替换标题，`join.documentTitle` 缺失同样让构建失败。替换后还有未处理的占位符也直接报错，不会把 `%…%` 发上线。服务器运行时品牌会覆盖构建期标题并在 HTML 里注入 `window.__CALMOBILE_BRANDING__`，页面 `app/runtime.ts` 首帧读它；`bootstrap.branding` 再确认一次，旧快照没有注入时也有兜底。
- 报名站不是可安装应用：`web/vite.join.config.ts` 关掉 `publicDir`，不生成 manifest 与 Service Worker，也不拷安装图标。
- 主屏幕名称与图标是安装时写进系统的，之后换语言包不会改；改运行时品牌或重新构建后要重启服务并重新「添加到主屏幕」。

### Service Worker 缓存边界

`web/src/services/pwa.ts` 只在生产构建、非报名站、没有原生桥、安全上下文里注册 `{base}sw.js`，作用域 `{base}`（即 `/app/`），并顺手申请持久存储。`sw.js` 由 `pwa-build.mjs` 按构建产物清单生成：

- 预缓存整个页面壳（`/app/index.html`、`/app/assets/*`、`/app/manifest.webmanifest` 与图标）；`release.json` 与 `sw.js` 自己不预缓存。
- 导航请求网络优先，断网时回退到安装时缓存的 `/app/index.html`；`/app/assets/` 按缓存优先。
- `/api/`、`/media/`、跨域请求与 `/app/` 之外的路径一律放行，不写缓存，所以没有离线业务数据。
- 缓存名是写 `sw.js` 时按当时产物清单（排除 `release.json`、`sw.js`）算出的 id，形如 `calmobile-app-<id>`；它和 `release.json.id` 不是同一个值（后者包含刚写出的 `sw.js` 自身），也不需要相等。每次构建变化；`activate` 清掉旧前缀的缓存。新版本不调用 `skipWaiting` / `clients.claim`：旧页面关掉后新 SW 才接管，避免旧页面在更新中途去取已经被新缓存清掉的旧资源；新页面在下次打开时生效，不在使用中重载。服务器生成运行时品牌层时也会按改过的页面文件重写 `CACHE_NAME`，否则已安装 PWA 的离线回退会停在旧标题/旧图标。

### 安装引导

- 安装引导不依赖 `beforeinstallprompt`（iOS Safari 没有，Android 与桌面浏览器也不统一）。`services/pwa.ts` 的 `shouldOfferPwaInstall()` 只判断「不是从主屏幕启动的独立窗口（`isStandalonePwa()`）且没有原生桥」；**不记录本机「已关闭」**，于是每次访问应用都会重新提示，装到主屏幕或从原生 App 打开后条件自然为假。
- 首页在首屏之后延迟 600ms 弹 `components/PwaInstallSheet.vue`（`mode: 'app'`）；别的面板开着时不盖上去。关闭不写任何存储。`HomePage.vue` 的模块级标记 `installHintOfferedThisVisit` 保证同一次页面会话只提示一次：底部导航切走再切回不重复，刷新 / 重开页面后模块重建，于是「每次访问」都会提示。
- 设置页在 `shouldOfferPwaInstall()` 为真时常驻「安装到主屏幕」入口，打开同一个抽屉；`mode: 'join'` 时多一颗「打开完整应用」。抽屉里给出完整应用地址（`PUBLIC_BASE_URL` + `/app/`，没配时退回当前 origin）与复制按钮，步骤按平台分支：iOS Safari 用分享面板（`stepOpen` / `stepShare` / `stepAdd`）；iOS 非 Safari 先提示换到 Safari（`notSafari`）；Android 用浏览器菜单（`androidIntro` / `androidStepOpen` / `androidStepMenu` / `androidStepAdd`）；桌面等只有 `desktopIntro` + `desktopStep`；Android / 桌面的内置浏览器加 `browserNotInstallable`。
- 报名站顶栏的下载 / 安装入口：iOS 打开安装引导（不要求管理员配下载地址），其它平台有下载地址才出现，点击走系统浏览器下载；入口在顶栏右侧，不再单独占一条悬浮条。

### 设备能力（浏览器实现）

`web/src/services/device-services.ts` 是页面唯一的设备能力入口：有原生桥走 `nativeBridge.call`，没有时走 `web/src/services/browser-device.ts`，两边返回同一种结果形状，页面不按环境写两套。

- 选文件：`media.pickImage` / `media.import` / `media.importText` 用临时 `<input type="file">`（图像按 EXIF 摆正、缩到最长边 1080 并转 JPEG；`accept`、大小上限沿用原生侧的约定）。
- 下载：`export.csv`、`export.text`、`media.saveImage` 用 Blob + `<a download>`；二维码图片因此存到「文件」而不是相册。
- 分享：`share.text` 用 `navigator.share`，不支持或失败时退回剪贴板并在结果里带 `copied`；调用点按 `shared` / `copied` 给反馈——系统分享成功或用户取消不额外提示，退回复制成功时提示「已复制」。`shareFile()` 供日历 ICS 这类文件分享，不支持时由调用方改走下载。
- 通知：`notify.requestPermission` 用 `Notification.requestPermission()`；仍然没有推送通道，只影响权限状态。
- 只有原生才有的动作（`ui.sync` 外观镜像、`media.store` 落盘）在浏览器里以 `device.featureUnavailable` 失败，页面不要把它们当浏览器可用能力。`media.discard` 在浏览器里是空操作；`media.import` 返回的 object URL 由 `services/publish-media.ts` 在上传结束或失败后 `URL.revokeObjectURL`。
- 日历：浏览器没有系统日历读写，详情页改走 `web/src/services/calendar-ics.ts` 生成 `.ics`（按 `Asia/Shanghai`；多天展会的 `DTEND` 是闭展次日；有分享面板就分享，没有就下载），因此不显示「移出日历」。
- 核销扫码：浏览器没有原生权限通道，`getUserMedia` 必须在点击的同一轮里发起；`NotAllowedError` / `NotFoundError` / `NotReadableError` 等归成相机不可用，提示改用选图扫码或手动输入报名码。

### iOS 样式

iOS 与主屏幕模式的适配在 `web/src/styles/special.css` 末尾：

- 旧版 iOS 不认 `dvh`：`body` 与 `.app` 先给 `100vh`，再用 `100dvh` 覆盖；构建压缩会把同一规则里的重复声明合并掉，所以另用 `@supports not (height: 100dvh)` 给不认 `dvh` 的内核补回 `100vh`。
- `@supports (-webkit-touch-callout: none)` 里把 `.input` / `.textarea` / `.select` 的字号抬到 `16px`，避免 iOS 聚焦输入框时自动放大整页；只改字号，边框与下划线不变。
- `@media (display-mode: standalone)` 下 `html, body` 设 `overscroll-behavior: none`，避免系统下拉回弹与页面内下拉刷新叠加。

## 数据加载

- 查询 composable 负责加载、缓存首屏、后台刷新和错误块。失败保持可见。有上次结果（包括已过期的）时先画出那份内容，再在后台刷新；刷新只标记忙碌，不清空旧内容。过期响应丢弃。列表里新出现的卡片滑入，不重放整表。下拉刷新忽略新鲜期，重新取当前页。加载圈随手指出，松手后才转动并发起请求；响应再快也先滑入、在展开位置停留，再滑出。缓存已画出而后台还在更新时只标记忙碌，不弹这枚指示：切页面、返回旧页面都不播加载动画，指示圈只属于用户的手动下拉刷新（`web/src/services/pull-refresh.ts`）。竖拉还要先越过 16px 死区、并且纵向明显占优（> 横向 1.5 倍）才跟手：点击页面里的链接/按钮时手指会漂几像素，不过死区就完全当没下拉。手势中途横向追平即放弃这次下拉；页面自己的横滑处理器（首页日历）判定要横滑时调 `suppressPull()`，外壳本次手势直接作废，斜划不会闪出指示圈。只有真正的 `pointerup` 会发请求，`pointercancel`（浏览器接管手势）只复位、绝不刷新。换页时外壳再调一次 `resetPullVisual()`，保证上一页的手势与动画不会把圈留在新页面上。
- 查询缓存集中在 `web/src/services/query-cache.ts`。缓存键包含稳定序列化后的参数，并对相同请求去重。底部导航按下时预取该页。月视图一次取整月，点日期在本地完成。`GET /exhibitions/month` 对跨天展会返回 `days`（本月内开展～闭展覆盖的所有天）并把它们并进 `eventDays`，首页按 `days` 判断选中日要展示哪些展会；没有 `days` 的旧快照退回 `day`。每条展会还带 `exhibitor`（展商昵称），首页卡片把展商名与分类拼成一行。个人圆点 `markedDays` 里，已通过 / 已参加的报名若选了参加时间就按那段区间打点，没选（老数据）仍按整场展会打点。
- 写接口的失效前缀与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`、`users` ↔ `users.record`）。
- 用户协议正文走 `api.agreement.get()` 直连，不进查询缓存（正文会随管理员保存变化）；`bootstrap` 只带 `{ enabled, version, updatedAt }` 摘要，登录/注册页据此决定是否展示勾选框。
- 最近日志页（`web/src/pages/LogsPage.vue`）用 `api.logs.list()` 直连，也不进查询缓存：日志随时在增长，打开页面、切级别、下拉刷新都取最新的一批；统计（条数、已用 / 上限）与列表来自同一次响应。
- 展会详情页判断本人是否报过这场展会时复用 `registrations` 列表读缓存（与报名写入同族失效），只在已登录时请求；取不到就按未报名处理，不因为这条增强查询让整页失败。个人页的活动概览同样是一次增强查询：复用 `registrations` 列表缓存统计已参加与报名记录数，取不到就不显示这一行，不影响资料主状态。
- 报名站的查询凭据（`/e/:id/status?token=`）走 `registrations.queryByToken` 直连，不进查询缓存（凭据不能进缓存键）；`claim` 成功后失效 `registrations` 与 `users.public` 前缀。
- 核销结果按账号存在本机（`calmobile.checkin.outcomes.<用户 id>`，最多 20 条，最新的在前）；核销页顶栏的清理按钮清掉它，换号按新键重读。
- 接口 JSON 带 `Cache-Control: no-store`。前端请求使用 `cache: no-store`，避免浏览器把带身份的旧资料（包括头像地址）当成可复用响应。管理端用户列表和搜索结果都带上头像地址，上传后这些页面跟着换图。

## 原生桥接

原生只处理设备能力：`ui.sync`、摄像头权限、系统日历、通知权限、图片选择与媒体落盘、文本分享、CSV 导出、网页里的文件选择（`WebShellActivity` 的 `onShowFileChooser`）、文本文件读取与另存为（`media.importText` / `export.text`）、图片写进系统相册（`media.saveImage`）、会话刷新令牌与可信设备凭据的设备存储（`session.save` / `session.load` / `session.clear` / `session.device`，见 `SessionStore.java`），以及通行密钥（`passkey.available` / `passkey.create` / `passkey.get`，见 `PasskeyActions.java`），以及退出应用（`app.exit`：用户不同意用户协议时结束当前 Activity）。

页面侧统一从 `web/src/services/device-services.ts` 进：有原生桥时调 `nativeBridge.call`，没有时同一组方法落到浏览器实现（`browser-device.ts`，见「iPhone / PWA」的「设备能力」）。因此浏览器里能用的是选文件、下载、分享、通知权限与摄像头；`ui.sync`、`media.store` 这类只在原生壳里存在的动作在浏览器里以 `device.featureUnavailable` 失败。

`WebAppBridge` 另有一个**同步**方法 `systemAppearance()`（不是动作、不进动作表与能力清单）：`index.html` 的内联脚本在首帧同步读 `{ systemDark, mode }`，让「跟随系统」在 Android WebView 里也能落到正确的深色（见「应用外壳」的明暗模式）。

**能力协商（页面可以比 APK 新）**：`app.capabilities` 是原生壳声明的动作清单（`ShellCapabilities`，排序去重；回包 `{ version, actions }`）。页面用 `native-bridge.ts` 的 `supportsNativeAction(action)` 懒加载并缓存这份清单，没有清单项就当壳不支持；原生对不认识的动作用稳定错误码 `unsupported` 失败，`device-services` 的 `nativeOrBrowser` 收到它时自动改走浏览器实现（`cancelled` 与真失败仍原样抛）。通行密钥也据此判断：旧壳没有 `passkey.*` 时退回浏览器 WebAuthn。因此新功能可以随页面热更新先上线，APK 只是可选增强；**新增原生动作时要同时更新 `ShellCapabilities` 清单与 `WebAppActions.handle` 的 switch**（两边对不上会误判能力，见 `ShellCapabilitiesTest`）。

选图分两条路：`media.pickImage`（头像、扫码选图）在原生侧优先打开系统相册 / Photo Picker——Android 13 起用 `MediaStore.ACTION_PICK_IMAGES`，低版本用 `Intent.ACTION_PICK` + 图片库，系统里没有相册应用时回退文件选择器；`media.import`（封面、视频、语言包正文等）仍走文件选择器，因为这些文件可能在下载目录里、相册看不到。浏览器里两者都退化成 `<input type="file">`，回包形状不变（`media.pick` / `ok` / `uri` / `mimeType` / `dataUrl`，取消走 `CODE_CANCELLED`）。

**为什么通行密钥在原生**：WebView 里 `navigator.credentials` 不可靠（多数版本没有 WebAuthn），而系统凭据提供方（Android 14 的 Credential Manager，低版本由 Google Play 服务提供）能用指纹 / 面容 / 锁屏密码完成同一件事。桥接传的入参与回调都是**标准 WebAuthn JSON**（base64url 字符串），服务端校验逻辑不区分请求来自 App 还是浏览器。页面侧统一走 `web/src/services/webauthn.ts`：有原生桥就调用桥，没有就用浏览器原生接口；用户取消由原生回 `cancelled`，前端归一成「没做这件事」。App 的 `clientDataJSON` 里 origin 是 `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`，所以服务端的 `WEBAUTHN_ORIGINS` 必须包含它（见 `operations.md`）。这一项不是 http(s) 地址，`config/env.ts` 单独认它的形状（43 位 base64url），不能只按 URL 解析——否则会被当成非法项丢掉，App 里的通行密钥全部因来源不符被拒。**取消按系统实际返回判定**：用户划掉面板时凭据提供方回的是 `CreatePublicKeyCredentialDomException`（DOM 类型 Abort / NotAllowed / Timeout），不是 CancellationException；这三类与 Cancellation / Interrupted 一起归成 `cancelled`，页面静默收场。其余失败在原生侧翻成中文说明，系统给的英文原文只进 logcat。网页关着文件与 `content://` 访问，因此从文件安装语言包时正文由原生读出来回传，底稿另存为与二维码保存也走原生。可信设备的随机凭据由原生 `session.device` 生成并保存在设备私有目录。浏览器预览使用本机存储。

`WebAppActions.handle()` 的动作表是唯一原生入口。业务数据动作留在服务端。动作失败回调 `callback.failure`。`AppSettings` 是后端设置的设备镜像，权威值由 `ui.sync` 下发。

日历只用后端下发的 `YYYY-MM-DD`。缺失或非法日期直接失败。

头像、封面和简介媒体上传到服务器。设备只负责选择和压缩，选完就把临时文件删掉。资源路径只允许单层文件名。大小、格式和存储上限由管理设置控制，口径见 [`server/README.md`](../server/README.md) 的媒体一节。头像格式只接受 jpg、jpeg、png、webp。

**上传进度**：字节上传可以带 `onUploadProgress(percent)`（`api.media.upload`、`api.profile.uploadAvatar`、管理员用的 `api.users.uploadAvatar` 与 `services/publish-media.ts` 的第三个参数）。`HttpClient` 只在同时带 `bytes` 与这个回调时改走 `XMLHttpRequest`（`upload` 事件能报已发送字节数），其余请求仍是 `fetch`；两条路的 401 刷新重放、超时/取消、5xx 与 `ok:false` 分类完全一致。界面统一用 `components/UploadProgressMask.vue` 盖在图片显示位置：暗色 scrim 从顶部退下、底部按百分比变亮，中间是百分比数字；父容器自己保持 `position: relative`，100% 至少停留 150ms 再由调用方卸载，失败/取消直接清掉。编辑展会封面、管理缺省封面、富文本插图与头像裁剪上传都接这一层，不要各自手写遮罩。

## 界面规则

- 每个字段有可见标签。标签和内容左对齐。
- **输入框默认是方框**（`--stroke` 描边 + `--f3` 浅底），只有明确需要下划线的地方加 `.input-line`：目前是管理设置页的全部一般输入、编辑展会页的名称/地点/日期与时间触发按钮/分类，以及收集项的「字段标题」。`.input-line` 由 `styles/components.css` 统一给出：默认一条 `--stroke` 底边，聚焦时一条主题色下划线**从左侧长满**（320ms，失焦缩回），校验失败直接变砖红——所有下划线输入框共用这一套动画，页面不要自绘。日期与时间不再使用原生 `date` / `time` 控件（全仓已清零），它们的触发按钮借用 `.input.input-line` 的外观（窄屏同样要给 `min-width: 0`，否则固有最小宽会撑破两列布局）。
- 报名截止日已过时，服务端在展会 payload 里下发 `registrationEnded`（数据库按 `CURRENT_DATE > registration_end` 判定，且只有需审核 / 无需审核才为真），`openForRegistration` 同时为 false；卡片状态灯与详情页状态统一读 `services/status.ts` 的 `exhibitionModeCode(item)`（截止后显示「截止报名」），详情页按钮按 `registrationEnded` 显示「报名已截止」、其它关闭原因仍是「报名已关闭」。管理端「暂停 / 恢复报名」按 `acceptsRegistration(statusCode)` 判断，不读 `openForRegistration`，避免已截止的展会显示「恢复报名」。
- 编辑展会时，闭展日期在提交前按管理员设置的最大持续天数做本地校验（`bootstrap.exhibitor.maxExhibitionDays`）；服务端保存时再校验一次，超限返回 `exhibition.durationTooLong`。分类必填（编辑页校验；服务端 `exhibitionInputSchema` 只在新建时强制，错误码 `validation.categoryRequired`，更新保持宽松以免历史空分类展会只改简介时被拒）；开展时间选填，两个时 / 分滚轮都填才组成区间，都空就是没设置。空时间的展示统一走 `services/format.ts` 的 `joinText(parts, 分隔符)`（过滤空片段再拼），列表、详情、分享文案与报名页卡片都不会留下「 · 场馆」或行尾空格；`calendar-ics` 没有可解析的时间时按全天事件处理。
- **日期与时间用应用内抽屉**：范围日期（开展/闭展、报名开始/截止）走 `components/DatePickerSheet.vue` 的 `range` 模式，单日期（会议日期）走 `single` 模式；时间走 `components/TimeWheelSheet.vue` 的时 / 分滚轮。入口统一是 `services/pickers.ts` 的 `openDateRange` / `openSingleDate` / `openTime`，页面不要自己拼面板、也不要用系统原生控件。范围选择第一次点选就把起点回填给表单、第二次点选终点后自动收起（因此报名窗口可以只填开始）；第二次点的是同一天时终点也回填这一天，表单两端的框显示同一个日期；已有一段完整区间时点任意一天从该天重新开始；终点早于起点禁用；`min` / `max` 夹住可选范围两端（会议日期挡今天以前，报名参加时间挡展会期间之外）；「清除」清空两端。时间滚轮在值为空时按开始 `09:00` / 结束 `17:00` 摆位，只有点「确认」才写回，「清除」把时间留空（时间选填）。月历按月份分节、周日起排、今天带圆点，渲染从已选月份往前 12 个月到往后 24 个月。
- **状态标签是「信号灯」**：`StatusTag` 只有色点 + 文字，没有边框与底色（ok 绿 / pending 琥珀 / danger 砖红 / info 灰蓝 / muted 灰），用在报名状态、展会报名方式与账号状态上。**身份标签不是状态**：展商 / 管理员走 `RoleTag`，保留原来的方框小签（浅底 + `--accent-edge` 描边 + 强调色文字），不要换成信号灯。
- 需要从固定清单里选值的字段用**应用内抽屉**：`openSheet({ layout: 'list', actions: [{ label, checked }] })`，当前值带对勾；不要用系统 `<select>`。
- **用户协议**：登录/注册页的勾选行只是「勾选 + 蓝链」，不套卡片外框（`.agreement-consent .check-label` 去掉描边、底色与内距，保留 44px 命中区）。管理员在「管理-设置」用开关 + Markdown 文件上传正文（应用内 `device.importText('text/markdown,text/plain', 1MB)` 读正文，浏览器退回 `<input type=file>` + `File.text()`；正文上限 200000 字符，随保存一起 `PUT /settings` 的 `agreement: { enabled, content }` 提交）。开启后登录/注册页显示「我已阅读并同意《用户协议》」勾选框，链接是 `--accent-ink` 的蓝链、打开 `/agreement`；用户设置页最底部同一入口；关闭时这些入口与更新弹窗全部不渲染。协议浏览页用 `api.agreement.get()` 公开取数（不进查询缓存），正文走 `markdownToHtml()` 清洗后渲染到 `.rich-content`。登录/注册页的勾选在各提交点（密码登录、两步验证、通行密钥、注册发码与提交）拦截，会话建立后调 `POST /profile/agreement` 记录当前版本，失败静默交给全局更新弹窗兜底。
- 分段控件（`components/SegControl.vue`）**优先排成一行**：`.seg` 允许换行、按钮等分剩余宽度收缩；每个按钮缩到最小可用宽度（`min-width: 56px`，`.seg button`）之后还放不下才换行，标签过长用省略号，不横向滚动、也不撑宽页面。选中滑块按按钮的 `offsetLeft / offsetTop / 宽度 / 高度` 定位，换行后贴在选中按钮所在那一行；容器尺寸变化由 `ResizeObserver` 重新量。
- 上传卡（封面、缺省封面）统一版式：左侧 96×170（9:16）预览，右侧竖排「上传/更换 / 移除」按钮与格式说明，窄屏上下堆叠。
- 编辑展会页的「活动信息」卡自上而下是封面行（右侧写「支持3:4~9:16纵图」与允许的格式）→ 简介 textarea（`#form-description`，直接编辑 Markdown 源码）→「使用Markdown编辑简介」按钮 →「参与方式（仅通过审核用户可见）」textarea（`#form-registration-notice`，2000 字）。点 Markdown 按钮时先把当前表单 stash 成内存稿（`services/exhibition-draft.ts`，草稿带展会 id），二级编辑器用它起稿，新建与编辑两条路径都保证文本框和二级页是同一份正文。编辑已有展会时二级页保存简介**仍然立即写库**，成功后把最新正文 `patchExhibitionDraft()` 写回草稿、**不清掉**，返回表单时按 id 恢复整张草稿，其他未保存字段不丢；只有离开到 `/exhibition-form*` 以外的目标时才清草稿。二级编辑器页面本身不再渲染展会标题卡，页面顶部只由外壳顶栏负责。
- 编辑 / 新建展会页的「已保存基线」是提交字段的 JSON 快照（初次取数、成功保存、报名方式即时保存、新建空表单时更新）；离开时 `onBeforeRouteLeave` 对「已构建且未受限 / 未加载失败 / 未丢失且有未保存修改」取消导航并打开抽屉（`layout: 'stack'`，保存 / 不保存 / 取消）。去 `/rich-editor` 直接放行且不清草稿；保存、不保存、删除成功与权限退回用自己的放行标记再 `router.replace(目标)`，保存失败留在本页原位报错。
- 图标是 24 视窗、1.5 描边、无填充的细线。顶栏图标没有圆底。底部导航是图标加文字，选中项只换 `--accent-ink` 与字重（图标轻微上浮），不画下划线或滑动指示条。表单右侧的展开 / 下拉统一用 `chevronDown`（管理用户筛选、活动分类等），日期触发按钮用 `calendar`，时间触发按钮用 `chevronDown`；`AppIcon` 的 `PATHS` 没登记的名字会回退成 `info` 圆形提示图标，新增图标名必须同时在 `PATHS` 里登记。
- 触控命中区域至少 44px。生产界面以 1080×2400、xxhdpi（逻辑画布 360×800）为密度基准，字号、间距和圆角取 `web/src/styles/tokens.css` 的当前值。状态同时用文字和颜色或描边表达。空、加载、错误、成功和禁用状态在原位置给出下一步。
- 顶栏使用 `--topbar-h`，再叠 `--safe-top`。有底部导航时内容区叠 `--safe-bottom`。Android WebView 里这两项 `env()` 经常是 0，因此 `WebShellActivity` 按系统栏 inset 缩小页面。并排字段等高。日期、时间和状态使用选择器、分段控件或面板。
- **海报缩略图与详情大图**：列表缩略图高度固定（`MediaBox` 按图片真实比例写行内 `aspect-ratio`），宽度在 **9:16 ～ 3:4（纵向 4:3）** 之间自适应，所以同一列表的卡片高度一致；超出范围的海报按最接近的一端比例收进区间、`object-fit: cover` 裁切填满。详情页只展示展会自己上传的海报（`imageUri`）：为空时不渲染海报区、占位图与灯箱入口，**不回退** `coverOf` 的管理员缺省封面；有海报时等比完整展示（`width: 100%; height: auto`，高度随海报比例，不裁切），特别长的海报用 `max-height` 兜住并 `object-fit: contain`；灯箱同样只做等比缩放，不裁切、不拉变形。
- 私约设置页顶链接行是 `.copy-line`：左侧链接文本，右侧复制与二维码两颗 44px 图标按钮。二维码复用 `components/ShareQrSheet.vue`（传 `qrLabel` / `hint` / `savedText` 覆盖成会议文案，不传则沿用展会文案），内容是 `meetingLink()`，文件名 `meeting-qr-<用户 id>.png`；没配 `PUBLIC_BASE_URL` 时只提示未配置，不打开空二维码。
- 管理-用户分区按身份与账号状态筛选：筛选值写进地址栏（`?tab=users&role=&status=`，非法值按「全部」），`GET /users` 接受 `role` / `status`，与 `query` 关键字同时生效（三者 AND）。两个筛选是排成一行的下划线选择栏（`.user-filter-row` 自适应网格，与编辑展会页的活动分类同一套；点开走 `openSheet` 的 `layout: list`，当前值带对勾），`AdminUsersSection` 只回抛事件，URL 同步与取数留在 `AdminPage`。
- 校验失败用专用 token：底色 `--danger-wash`、描边与下划线 `--danger-edge`（比 `--danger-tint` / `--danger-ink` 浅一档，浅色 / 深色三套主题都定义），文字仍用 `--danger-ink`；`--danger-tint` 的其它用途（状态标签、提示条、危险按钮）不动。`data-invalid` 从无到有时字段播一次轻微横向抖动，`.field-error` 淡入上移；`prefers-reduced-motion: reduce` 下这两段动画关闭。
- 强调色使用 `--accent*`。二维码展示时保持白底黑点（展商分享图的导出是唯一例外：透明底、黑色点，白底只来自展示容器）。Markdown / HTML 先经 `web/src/services/markdown.ts` 清洗再渲染；Markdown 表格渲染成 1px 框线、列宽随内容、单元格可换行、放不下时表格自己横向滚动的样式（定义在 `.rich-content`）。管理-设置的保存按钮是右下角悬浮圆形按钮（`.round-action`，投递到 `body`，否则页面切换动画的 transform 祖先会改掉 `position: fixed` 的包含块）。
- **页面里的固定遮罩必须 `Teleport` 到 `body`**：路由容器 `.route-enter.page-surface` 带着填充到结束态的 transform 动画（播完后的计算值仍是恒等矩阵），会一直是 `position: fixed` 的包含块；遮罩留在页面里会被压进内容区、只盖到内容高度（`AvatarCropper` 就踩过这个坑，`ImageViewer` 与悬浮按钮早已投递到 `body`）。
- 个人页与设置页按 `section-label` 分组：组标题放在卡片外，组内间距一档、组与组之间一档；卡片里的开关行用 `.switch-row[data-flush='true']` 的分隔线版式，不再套第二层边框；导航入口直接用 `.row-card`。个人页的身份区、活动概览、简介与公开资料**不使用卡片外观**（保留 `.card` 钩子是给页面测试用的，用页面级 `[data-plain]` 把边框、底色、阴影与内距去掉）。名字用 `.identity-name`。
- 卡片里再套 `.row-card` 会形成双层边框：可点的整行不要包在第二层 `.card` 里；需要分区时改用卡片 `gap`、局部间距类与 `section-label` 层级，**不再画发丝线**（`hr.divider` 已从设置类、详情类卡片里移除）；只有列表行之间的分隔才用线（例如相邻 `.switch-row[data-flush='true']` 的上边线）。
- 展商后台：顶部一颗「核销报名码」，列表每张卡上半是整块可点的主体（右侧垂直居中一枚 44px 命中区的二维码分享按钮），下半放 ghost 小按钮（查看报名 / 编辑展会 / 复制链接），上下两段只用间距分开、不加分隔线；「复制链接」点击即复制（`services/clipboard.ts` 的 `copyText`，Clipboard API 失败时退回隐藏 textarea + `execCommand`），成功或失败都只 toast，不再弹手动复制面板；二维码按钮打开 `components/ShareQrSheet.vue`，二维码内容是报名站分享链接，导出透明底黑点 PNG（`qr-encoder.ts` 的 `background: 'transparent'` + `foreground: '#000000'`，保存走 `media.saveImage`，浏览器里退回下载）。「新建展会」是右下角悬浮圆形按钮（`Teleport` 到 `body`，否则路由容器的 `transform` 会成为 `fixed` 的包含块），空态时由 `.state` 的入口承担、不再显示悬浮按钮。
- 设置类页面里，「设置项标题」用 `--fs-body` / 700 / `--ink`，说明文字用 `.field-hint`（`--fs-meta` / `--ink-3`）——两者不能同字号同颜色，否则读不出层级。间距也按这一层级排：**标题与它下面那句说明 2px**（读成一块），**设置项与设置项之间 16px**，卡片内组标题到内容 12px；说明最长 34em，不要拉到屏幕右边缘。
- 资料抽屉最上方的头像块（`components/ProfileAvatarField.vue`）只剩居中的大头像与右下角铅笔（44px 命中区），设置页与个人页的身份卡只展示头像。点铅笔由 `services/profile-editor.ts` 先 `PUT /profile` 保存当前资料，成功后关闭资料抽屉；退场动画（260ms）结束再直接 `device.pickImage()` 拉起系统选图，选定图片后写 `services/profile-avatar.ts` 的 `source`，由个人页 / 用户设置页常驻的 `components/ProfileAvatarCropper.vue` 弹出 `AvatarCropper` 裁剪抽屉，裁剪完成立即 `POST /profile/avatar` 上传并刷新会话（裁剪面板确认后会自行退场，上传进度改为挂到 body 的固定层，在居中的头像槽位里显示同一套百分比遮罩；没有中转页，也不提供移除头像入口；取消选图静默结束）。`PUT /profile` 仍原样回传 `avatar`，避免把头像当成清空。管理员从公开页代改别人资料（`targetUserId`）时头像块照常渲染，但显示的是目标用户的头像：点铅笔仍先 `PUT /users/:id/profile` 保存，再选图裁剪，上传改调 `POST /users/:id/avatar`，成功后把新 `avatar` 合并回调用方的资料对象并触发 `onSaved`，**不写当前管理员会话**；`ProfileAvatarField` 因此接受外部传入的 `avatar` / `nickname` / `limited`（缺省仍取会话），`services/profile-avatar.ts` 与 `ProfileAvatarCropper.vue` 按有无 `targetUserId` 选择上传接口。
- `AvatarBox` 是唯一渲染用户头像的组件：图片 404 / 加载失败 / 解码失败时回退成昵称首字（`@error` 置失败态，`src` 变化后重新尝试），不留破图；回退态的边框与底色跟「没有头像」一致。
- 用户公开页扉页上的「已参加展会」是单个统计，数字与标签**居中**排；个人页的活动概览是两列并列统计，保持左对齐，不要一起改成居中。管理员视角（`viewedAsAdmin`）在昵称右侧显示小铅笔（`.public-edit`），复用 `services/profile-editor.ts` 的资料抽屉：传 `targetUserId` 时保存走 `PUT /users/:id/profile`，只合并目标用户资料，不改当前管理员会话。
- 「我的活动」的列表行：缩略图高 78（竖版海报比例，宽度随海报比例在 9:16～3:4 纵向之间自适应），标题单行截断，状态信号灯压在标题行右端，下面依次是「日期 · 时间」、地点与摘要（摘要两行截断，用 `.clamp-2`）。展商卡同理，但状态与报名数合成**一条**信号灯文字，避免出现「左边空着」的独立一行。
- 报名收集项仍是「一张卡 + 横线分隔」的老结构，段内顺序不变（字段标题输入 → 类型分段 → 提示 → 选项行 → 必填与删除）。只把「字段标题」那一个输入框换成下划线：「标题」两个字作**占位符**显示在框内，不再浮在输入框上方；每一项上方留 12px、分隔线下方 16px，不靠浮动标签撑间距。
- 展商后台的列表卡：上半是整块可点的主体，下半是配置动作按钮，两者之间**不加分隔线**（只靠卡片自身的间距分开）；「我的活动」等其它列表卡不受此影响。
- 用户公开页的「已参加展会」用两列网格，每格图片 `aspect-ratio: 3 / 4`，图下两行小字（名称 + 日期）。
- 动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。动效全失时先看设备动画 scale，步骤见 [`operations.md`](operations.md)。
- 首页切月有两种入口：两颗不带圆框的 `chevronLeft` / `chevronRight` 按钮（`.icon-button`，去掉 `data-variant="outlined"`），以及下面的滑动。滑动用三块 `components/CalendarMonthPanel.vue`：当前月可交互，左右两份是相邻月预览（只按本地日期排，不带展会高亮，`aria-hidden` + `inert`，按钮全部禁用）。拖动时三块一起平移，露出的位置始终是相邻月份的日历而不是空白；松手过阈值后卡片与预览一起滑到位再换月，动画结束用新月份接口数据重画。相邻预览不额外发请求；切月动画只动 transform，减少动效时直接换月。
- 第三方库由 `web/package.json` 与锁文件管理。重型功能动态导入，构建进页面包，运行时不引用 CDN。页面包随 APK 带一份；正式包再从本站 `/app/` 热更新到本机快照，切换页面只读这份快照。
- 二维码在 Worker 里串行解码。暂停与换页后丢弃过期帧，离开时释放 Worker 和摄像头。WASM 通过构建资源定位到本地文件。

## 文案

状态、报名方式、收集项类型、角色这些**协议值一律用英文 code**（`pending` / `review` / `text` / `exhibitor` …）：服务端 `server/src/domain/labels.ts` 与前端 `web/src/services/status.ts` 是同一套 code 的定义处，改一边必须同步另一边，接口只下发 code（`statusCode` / `role`），界面按 code 查 `status.*` / `role.*` / `fieldType.*` 取文案。中文标签字段（`status` / `statusLabel` / `modeLabel` / `roleLabel`）是给还没更新快照的旧页面留的兼容层，新代码不要读（`web/src/api/compat-fields.test.ts` 盯着 `statusLabel` / `modeLabel` / `roleLabel` 三个读取；`status` 太容易和 HTTP 状态、表单模型撞名，靠扫描与评审），更不要拿它当比较或回传的值——装了语言包会比不中、还会把译文写进库里。下线条件：客户端快照不再存在旧版本后，服务端删掉这几个字段，同时删掉那条守卫测试。收集项类型在 `0018-field-type-codes` 里从中文迁到 code（`exhibition_fields` 与 `meeting_fields` 两张表）。

界面文案在 `web/src/i18n/zh.json`，**嵌套 JSON**（`{"auth": {"login": {"title": "登录"}}}`）；前端仍用点分路径 `t('auth.login.title')` 读取，加载时压成扁平表，热路径不逐层查找。带变量的整句写成一条，变量在文案里写 `{名字}`，取值时用第二个参数给：`t('auth.login.secondsUntilResend', { seconds: 30 })`，值可以是字符串或数字；参数里缺哪个名字，屏幕上就原样留着 `{名字}`（跟整条缺失时显示路径同理），所以调用处不要把取到的文案再拼给别人看。模板里的中文写成 `:placeholder="t('exhibition.form.venuePlaceholder')"` 这种绑定，带参数是 `:aria-label="t('profile.avatarLabel', { name: props.name })"`。别的语言缺哪条，就用中文那条。周几、年月留在 `web/src/services/format.ts`，不进这张表。邮件正文在后端，不进这张表。构建时中文表打进应用页面包和报名站包，不单独发布源文件。

PWA 安装元信息同样来自这张表：`app.documentTitle`、`pwa.manifest.shortName`、`pwa.manifest.description`，安装引导用 `pwa.install.*`（含 Android / 桌面 / 内置浏览器分支文案），报名站的顶栏下载 / 安装入口用 `join.downloadApp` 与 `join.iosAction`。`web/pwa-build.mjs` 在构建时读这些键生成 manifest 与 HTML 占位符；缺键（manifest 的 `name` / `short_name` / `description`、`join.documentTitle`）或占位符没替换完，构建直接失败，不会把空值或 `%…%` 发上线。新增可见文案先进 `zh.json`，不要散落在构建脚本、HTML 或页面组件里。

用户自己的语言包记在本机 `localStorage`，不在 `web/dist` 或客户端快照里。语言包与内置中文表同一套嵌套格式（`strings` 里对象套对象、叶子是字符串），顶层是 `id` / `name` / `version`（包内版本号，非负整数，缺省 0）；带变量的文案同样写 `{名字}`、名字要和中文表对得上（对不上就原样留在屏幕上），包里那条要是没有 `{名字}` 的旧片段文案，参数不会补进去、屏幕上会少一段，改过占位或把片段合成整句之后语言包要跟着一起更新，落盘时也写嵌套，否则升级后已装包会被当成坏包丢掉；旧的扁平包按约定不再兼容，服务器 `LANG_PACK_URLS` 指向的包也要换成嵌套版（「下载中文底稿」的输出可直接当模板）。个人设置可以切换语言，也可以粘贴链接或选择 JSON 文件安装（应用里由原生读文件正文，见「原生桥接」）。应用与报名站都按服务器默认语言（`LANG_PACK_DEFAULT`）选语言：应用里用户显式选择过则优先，报名站不看个人选择；默认名称对应的包没装时都回退中文。自动下载不会覆盖已经安装的同名包；唯一例外是**跟随服务器默认语言**（应用里没选过语言，报名站始终如此）：启动后拉一份服务器上的默认包，按包内 `version` 比本机那份新就覆盖（用户显式选过语言的包不动，检查失败静默跳过）。切换语言后整页重新加载；默认包按版本更新后也重载一次，让整页都用新文案。安装成功的提示排到重载之后（`services/toast.ts` 的 `toastAfterReload`），重载后的首帧靠 `services/session-hint.ts` 那条本机提示先等会话恢复，不闪登录页。下载中文底稿在应用里走系统「另存为」，浏览器里退回浏览器下载。
