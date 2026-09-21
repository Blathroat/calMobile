# 构建、测试与上线

## 环境要求

- Android Studio、JDK 17、Android SDK 36.1（`compileSdk`）、Gradle Wrapper 9.7.1（Android Gradle Plugin 9.3.0，Android Studio 支持的上限）；Windows 用 `gradlew.bat`，Linux/macOS 用 `./gradlew`。
- Node.js 18+ 与 pnpm（后端 `server/`），PostgreSQL 跑在 Docker 里（`pwsh -File scripts\db.ps1 start`）。

## 构建、测试与运行

```bash
# 结构检查（清单、桥接契约、页面文件、设计令牌、动效层、内置依赖、文档）
node scripts/smoke-check.js

# 前端静态检查（ES 模块解析、动作名与页面文件一致性）
node scripts/webui-check.js

# 检查脚本自身的单元测试（启动入口解析等）
node --test scripts/smoke-check.test.js

# 前端页面渲染冒烟测试（最小 DOM 打桩 + 假桥接，逐页渲染并校验关键交互与 REST 映射）
node --test scripts/webui-render.test.js

# 前端文案一致性（源码 / strings_frontend.xml / FrontendStrings.NAMES）
node scripts/check-strings.js

# 后端契约与规则测试（真实 PostgreSQL，自动建/重建 calmobile_test 库）
node --test server/test/api.test.js

# Android 单元测试与调试 APK
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug

# 运行指定测试
gradlew.bat :app:testDebugUnitTest --tests 'com.example.calmobile.CalendarHelperTest'
```

后端开发请进入 `server/`，按 `server/README.md` 起好 PostgreSQL 并复制 `.env.example`；常用命令为 `pnpm install`、`pnpm run db:migrate`、`pnpm run db:seed`、`pnpm run dev`、`pnpm test`（jest 单测）、`pnpm run test:contract`（接口契约）和 `pnpm run lint`。

客户端测试位于 `app/src/test/java/com/example/calmobile/`（39 项），覆盖系统日历的日期与时间解析、媒体上限区间与后缀列表解析、设备镜像、CSV 导出、桥接取值助手和资源路径守卫（`CalendarHelperTest`、`AppSettingsTest`、`ExportManagerTest`、`WebAppBridgeTest`、`AssetGuardTest`）；Activity 级 UI 测试仍在路线图中。原生与前端的日历契约按**后端下发的 ISO 日期**（`YYYY-MM-DD`）传参，不要在原生侧猜年月——写死月份的缺陷曾让事件落到错误的月份，而测试把常量抄成期望值后照旧全绿。

后端测试分两层：`server/test/api.test.js`（59 项）跑真实 Express + PostgreSQL，逐接口断言页面用到的字段、四类身份的权限边界、报名窗口 / 重复报名 / 自动通过 / 审核状态机与核销流转 / 报名收集项校验 / 登录限流 429 / 隐私开关（公开页不下发报名码）这些业务规则、**邮箱验证码体系**（两步注册、找回密码不泄露存在性、两步验证的票据与令牌边界、改邮箱要验证新地址）、数据库不可用时的状态页降级，以及**前后端路由交叉校验**（前端每个数据动作都有对应路由、后端没有前端用不到的路由）；`server/src/**/*.test.js`（jest，95 项）是不依赖数据库的纯函数与单测。库结构变更后跑 `pnpm run db:migrate` 即可，迁移是幂等的。

前端另有 `scripts/webui-render.test.js`（35 项）：它用最小 DOM 打桩加假后端 `fetch`，把 20 条路由用例（同一页面的不同参数各渲染一次）都真渲染一遍，并校验管理后台分区记忆、深色模式切换、报名码展示、展商卡片入口、扫码核销、用户公开页管理视角、注册与找回密码的两步流程、「数据动作不再经过原生桥接」「点日期与切月份不再取数」「缓存命中时同步出内容」「过期缓存仍可先画一屏」「并发请求去重」「标签页预加载」等取数体验，以及 `api.js` 的动作到 REST 路径映射与 401 自动续期。渲染测试通过 `router.whenStarted()` 等待首次渲染完成，用例涉及预加载时先 `await settle()` 排空空闲队列再开始计数，不依赖固定的 sleep 猜测时序。

`scripts/smoke-check.js` 本身是一百多项结构检查（清单入口、桥接契约、页面模块、设计令牌、动效层、内置依赖与文档关键内容），并守住「已删除的旧结构不要重新出现」；它同时校验本文档与 `docs/` 的关键内容。

## 模拟器回归

可用模拟器时，可安装并逐屏回归：

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.example.calmobile/.WebShellActivity

# 仓库内提供的回归辅助脚本（截图、按可见文字点击、查看日志）
pwsh -File scripts\emu.ps1 install
pwsh -File scripts\emu.ps1 shot .omo\evidence\02-home
pwsh -File scripts\emu.ps1 tap-text "以访客身份浏览"
pwsh -File scripts\emu.ps1 logs

# 动效回归前先确认设备的动画开关（详见 docs/ui-standards.md 的「动效标准」）
pwsh -File scripts\emu.ps1 motion
```

`emu.ps1` 的 `tap-text` 依赖系统的无障碍节点树，WebView 里的文字不会出现在 UI dump 中，因此界面回归要用 `tap <x>,<y>` 按坐标点击：截图是 1080×2400，而在对话里预览时会被缩到一半，换算坐标时注意 ×2。

报名二维码可以用设备截图做端到端校验：先在报名详情里截屏，再用内置解码库识别屏幕上的真实像素。

```powershell
adb shell screencap -p /sdcard/qr.png
adb pull /sdcard/qr.png .omo\evidence\qr.png
# 整张截图自动搜索，或指定区域 x,y,w,h
node scripts/decode-shot.js .omo\evidence\qr.png
node scripts/decode-shot.js .omo\evidence\qr.png "254,1145,572,572"
```

`decode-shot.js` 自带一个不依赖第三方包的 PNG 解码器（Node 内置 zlib 即可），把截图还原成 RGBA 后交给 `assets/web/vendor/jsqr` 里的同一个解码库，因此“识别成功”等价于展商扫码时也会成功。

## 启动耗时打点

首帧慢是 WebView 应用的常见问题，因此 `core/bridge.js` 内置了打点：`mark()` 在关键节点记录 `performance.now()`，`reportTimings()` 把结果写进 `window.__CALMOBILE_TIMING__` 并打印一次，原生 `onConsoleMessage` 会转进 logcat。

```powershell
adb logcat -s WebShellActivity | Select-String "web timing"
# web timing: main-start=2ms native-ready=432ms boot-start=134ms ready=140ms
#             page:login=210ms api-loaded=241ms bootstrap-done=1295ms entered=1296ms
```

本机模拟器上的实测基线：`bootstrap-done ≈ 1.3s`、登录页首帧 `≈ 210ms`（直接发请求，不做「先探测再请求」的预探测——预探测每次超时 1.5s、还要连试三轮）。后端不可用时首屏直接给出连接失败的原因。

预置演示账号：`demo/password`（管理员）、`exhibitor/password`（展商）、`user/password`（普通用户）；未登录用户只能浏览公开展会详情。

## 仓库内容边界

下列内容属于本机环境或运行记录，已写入 `.gitignore`，不随代码分发；如果之前已被跟踪，用 `git rm -r --cached <路径>` 停止跟踪（文件仍保留在本地）：

| 路径 | 说明 |
| --- | --- |
| `build/`、`**/build/`、`*.apk`、`*.aab` | Gradle 构建产物 |
| `.gradle/`、`.gradle-local/`、`local.properties` | Gradle 缓存与本机 SDK 路径 |
| `.idea/`、`*.iml` | IDE 工程文件，由 IDE 自行生成 |
| `.omo/`、`.opencode/`、`.codegraph/` | 编码助手运行记录与本地工具缓存 |
| `*.log`、`captures/`、`*.hprof` | 日志与性能采样文件 |

## 上线部署清单与开销

代码做完不等于用户能用：**后端目前没有对外开放部署**（无 HTTPS、无域名、`CORS_ORIGIN=*`），而邮箱验证码体系要真正跑起来必须先上线 —— 验证码得能发到真实用户的邮箱，注册、找回密码与两步验证才有意义。下面按「必须先做 / 上线时做 / 上线后观察」三档列出；成本按**已有域名与公网服务器**估算，纯本地开发不需要其中任何一项。

### 必须先做（不做就不能对外）

| 项 | 做法 | 成本 |
| --- | --- | --- |
| HTTPS + 反向代理 | Caddy（自动申请 Let's Encrypt 证书）或 Nginx + certbot，反代到 `127.0.0.1:3000` | ¥0 |
| 客户端改回严格模式 | `WebShellActivity` 的 `MIXED_CONTENT_ALWAYS_ALLOW` 改回 `NEVER_ALLOW`；`js/core/api.js` 的 `BASE_URL` 指向 `https://api.<域名>/api/v1`；顺手清掉 manifest 里不再需要的明文放行 | ¥0，但要重新出包 |
| 收紧 CORS | `CORS_ORIGIN` 从 `*` 改为 WebView 的起源（`https://appassets.androidplatform.net`），`credentials` 保持 false | ¥0 |
| 换掉示例密钥 | `JWT_SECRET` / `JWT_REFRESH_SECRET` 换成随机值（`openssl rand -hex 32`），数据库密码别再是 `postgres/postgres`；**再配一个 `TOTP_SECRET_KEY`** 并长期保管（验证器密钥用它加密，换掉它用户得重新绑定） | ¥0 |
| **保护 `/status` 与 `/api/v1/status`** | **已内置**：`pnpm start` 进生产模式后这两个接口直接 404（它们会暴露迁移清单、各表行数与接口清单，失败时还带 pg 的错误原文）。确实需要时用 `ENABLE_STATUS_PAGE=true` 打开，并靠反代加 Basic Auth / IP 白名单；对外探活只留 `/ping` | ¥0 |
| 发信域名 | 用**专用子域**（如 `mail.<域名>`）而不是主域，并配好 SPF / DKIM / DMARC —— 验证码邮件的信誉问题不该污染主域 | ¥0 |
| 不要部署 Mailpit | `scripts/mail.ps1` 与 `MAIL_SMTP_HOST=127.0.0.1:1025` 只用于本地开发；生产必须指向托管中继 | ¥0 |

### 上线时做

| 项 | 做法 | 成本 |
| --- | --- | --- |
| 进程守护 | systemd 单元或 `pm2`，配自动重启；`src/index.js` 已处理 `SIGTERM` / `SIGINT` | ¥0 |
| 数据库 | 继续用 Docker（`calmobile-pg` + `--restart unless-stopped`）；**时区必须是 `Asia/Shanghai`**，报名窗口与日历落点依赖数据库的 `CURRENT_DATE` | 见下 |
| 备份 | `pg_dump` 每日导出 + 卷快照保留 7 天，并**演练一次恢复**（没演练过的备份不算备份） | ¥0 |
| 日志 | 请求日志交给 journald / Docker 日志轮转，避免把磁盘写满 | ¥0 |
| 发信通道 | 阿里云邮件推送 / 腾讯云 SES（国内收件箱送达最好，大陆节点通常要求发信域名已备案）或 Resend / Brevo（免备案，QQ/163 可能进垃圾箱）；只改 `.env`，代码不动 | 见下 |
| 部署顺序 | `pnpm install --frozen-lockfile` → `pnpm run db:migrate` → 重启进程；迁移幂等，**先迁移再重启** | ¥0 |
| 重新出包 | 上面的客户端改动 + 域名一起发版；Android 侧还要把 `usesCleartextTraffic` 与明文说明去掉 | ¥0 |

### 上线后观察

- **启动日志**：`pnpm start` 会打印「运行模式：production」「状态页：已关闭」以及配置自检的警告项；致命项（开发密钥、默认库密码、验证码只写日志）会直接拒绝启动 —— 这是上线前最后一道机器检查。
- 需要排查时临时开一次状态页：`ENABLE_STATUS_PAGE=true pnpm start`（或在 `.env` 里打开），查完记得关掉。
- `/status` 的「邮件通道」自检项：通道配置是否完整 + 最近 24 小时发信失败数（读 `mail_log`）。**发信失败率是这套功能的第一指标** —— 发信成功而用户收不到最难查。
- 发信量与限流命中：`email_codes` 按用途 + 邮箱限流（60 秒 1 条 / 1 小时 5 条 / 24 小时 15 条，同 IP 1 小时 20 条）。真被脚本刷时再加图形验证码。
- 两步验证的支持成本：邮箱失效的账号只能由管理员在「管理 → 用户」关闭两步验证，这条路要写进客服流程。

### 现金开销

| 项目 | 已有域名 + 公网服务器 | 从零置办 |
| --- | --- | --- |
| 域名 | 已有 | ¥50–100/年 |
| 2C2G 轻量服务器 | 已有 | ¥60–100/月 |
| HTTPS 证书 | ¥0（Let's Encrypt） | ¥0 |
| 发信 | 免费额度内 ¥0（阿里云邮件推送 200 封/天、腾讯云 SES 1000 封/月、Resend 3000 封/月这一量级；**具体额度以各家官网为准**） | 同左 |
| 备案（只在大陆节点需要） | ¥0，但要 **1–3 周**，且需要一台 ≥3 个月的大陆服务器 | 同左 |

**已有域名与服务器时，上线的额外现金开销基本为 0**，真正的成本是备案的等待时间与一次重新出包。要给国内邮箱发信又不想等备案，可以先用境外节点 + 国际发信服务把功能跑起来，等备案下来再切回国内通道 —— `services/mailer.js` 的适配层就是为这种切换留的。

## 隐私与合规

邮箱属于个人信息，对外收集必须给告知与同意：需要补一页隐私政策（收集什么、用来做什么、保留多久、如何删除），注册页明确告知「邮箱用于接收验证码与账号安全通知」。以后若加**通知类**邮件（报名结果、展会提醒），要提供退订入口 —— 验证码这类事务型邮件不需要退订，营销与提醒类需要。以上是工程侧的检查项，具体合规结论以法务意见为准。
