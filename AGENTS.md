# Repository Guidelines

> 给代理的短指南。每条都回答：「不写的话会不会做错？」能从代码、`package.json`、`README.md` 直接读到的细节不要复述。产品说明按主题拆在 `docs/` 下（`README.md` 只放简介、快速开始与文档索引），后端细节在 `server/README.md`。

## 命令（按这个顺序）

仓库根目录：

```bash
node scripts/smoke-check.js
node scripts/webui-check.js
node --test scripts/smoke-check.test.js
node --test scripts/webui-render.test.js
node scripts/check-strings.js
node --test server/test/api.test.js
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug
```

POSIX 用 `./gradlew`。后端在 `server/`：

```bash
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                 # 开发（状态页开着）
pnpm start               # 生产（关状态页、启动自检）
pnpm test -- --runInBand
pnpm test:contract
pnpm lint                # oxlint
pnpm format              # oxfmt
```

数据库：`pwsh -File scripts\db.ps1 start`。本地收件箱：`pwsh -File scripts\mail.ps1 start`。配置抄 `server/.env.example`，不要提交 `.env`。起来后看 `http://127.0.0.1:3000/status`。

改了前端文案源码后跑 `node scripts/extract-strings.js --write`。

## 布局

- `app/`：Android 客户端，**Java 25**（toolchain + `compileOptions`）。唯一入口是 `WebShellActivity`（WebView 容器）。页面在 `app/src/main/assets/web/`。纯 Java 工程必须关 `android.builtInKotlin`：AGP 9 仍会建 Kotlin 编译任务，而 Kotlin JVM 目标最高 24。
- 原生只做设备能力：日历、通知、摄像头、媒体、分享、导出、系统栏。权威动作表是 `WebAppActions.handle()` 的 switch，**不要往原生加数据实现**。
- `server/`：Express + PostgreSQL，独立 Node 工程（pnpm），不是 Gradle 模块。数据只在后端。
- 旧 Room / Retrofit / 本机 SQLite / legacy 页面已删除，不要重新引入。

## 前端

- 数据只走 `js/core/api.js` 的 `ENDPOINTS`。后端连不上就报错，没有原生降级。
- 页面取数用 `js/core/loadable.js` 的 `loadInto()`：失败必须让用户看见，不要 `Promise.allSettled` 吞错后照常渲染。
- 预加载只放 `js/core/preload.js`，去重键带上解析后的参数。
- 用户可见文案：`res/values/strings_frontend.xml` + `t('key')`。资源**不得首尾空白**（Android 会裁掉，JS 不会，间隔会粘在一起）。间隔用标点或代码拼接。
- 颜色 / 字号 / 间距 / 圆角只在 `styles/tokens.css`；动效只在 `styles/motion.css`。强调色只用 `--accent*`，不要写死色值。
- Markdown / HTML 先经 `js/core/sanitize.js`；渲染用 `core/markdown.js` 的 `renderMarkdown`。第三方库内置到 `assets/web/vendor/`，不引用 CDN。
- 新页面同时改：`js/app.js` 路由、`docs/architecture.md` 的屏幕对照表、`scripts/smoke-check.js` 与 `scripts/webui-check.js` 的页面清单。管理功能优先内联，不新开二级页。
- 表单校验走 `js/core/validate.js`，上限取 `state.limits`。

## 原生

- 日历按后端下发的 ISO 日期（`YYYY-MM-DD`）定位；缺日期或格式非法就失败，不要猜年月。
- 动作失败必须 `callback.failure`，不要把「没写成」回报成成功。
- `AppSettings` 只是设备镜像；权威值在后端，由 `ui.sync` 推过来。

## 后端

- 状态在库里存英文代码，中文标签只在 `server/src/domain/labels.js` 映射一次。
- 写入接口返回 `{ ok, error, ... }`（页面看 `.ok`）；读取直接返回数据。规则失败用 200 + `ok:false`，认证授权 4xx，**数据库不可用 503**。正文不回传 pg 原文、SQL 或堆栈。
- 新接口同时补：`api.js` 的 `ENDPOINTS`、后端路由、`server/test/api.test.js`（那里交叉校验前后端路由）。
- 公开接口不要下发 `checkInCode` 这类凭据。
- **运行模式**读 `server/src/config/runtime.js`。`index.js` 与 `config/migrate.js` 的第一行 require 必须是它。`pnpm dev` 开发，`pnpm start` 生产（关 `/status`、启动自检）。生产库迁移用 `pnpm db:migrate:prod`。改了 `server/src/*.js` 要重启进程。
- **邮件**：`server/src/services/mailer.js` 的 console / smtp / memory。不要在应用服务器上自建 SMTP。发码先落库、立刻回包、后台发信（前端超时 3 秒）。邮件文案在 `services/mail-templates.js`，不进 `strings_frontend.xml`。
- **邮箱是身份**：唯一且必须验证过。改邮箱只能「验证码发到新地址、通过才落库」。`PUT /profile` 不接受 `email`。
- **两步验证**：密码对了而码没过时**不得下发任何令牌**。判定集中在 `domain/two-factor.js`。验证码 / 票据失败走 200 + `ok:false`，限流才是 429。

## 界面与提交

- Java 四空格、PascalCase 类名、camelCase 成员、`snake_case` 资源。前端 class / 页面文件 kebab-case。注释和文档用中文。
- 触控区域不小于 44px；展会图按 9:16 展示；顶栏用 `--topbar-h`，标题下不加装饰线。
- 界面改动用 `pwsh -File scripts\emu.ps1` 回归。动效回归前先 `pwsh -File scripts\emu.ps1 motion check`：设备 `animator_duration_scale = 0` 会让 WebView 当成「减少动效」，那是设备开关。
- 提交用简洁中文动词短句。只提交本次路径，不回退无关文件，不为了“干净”删本机缓存。`.gitignore` 已覆盖构建产物、`.env`、`.agents/`、`.claude/`、`.grok/`、`skills-lock.json` 等。

## 文档

新增或更新需求按主题改 `docs/` 下对应的那一份（`features.md` 功能与验收、`architecture.md` 架构与前后端边界、`ui-standards.md` 界面与动效、`deployment.md` 构建与上线、`roadmap.md` 限制与未决项），不要再创建重复的需求、架构或 Review 文档；`README.md` 只保留简介、快速开始、项目结构、常用命令与文档索引。**所有文档只描述当前状态**：不写「变更记录」、不写迁移过程、不写「以前是怎样的」，历史看 `git log`；已解决的问题从清单里删掉而不是标注「已完成」。设计稿与实现的冲突只记录在 `docs/roadmap.md` 的「待裁决清单（未决项）」，未确认前不要擅自扩大数据模型。代码行为、依赖或命令变化后同步更新对应说明，并运行 `node scripts/smoke-check.js` 与 `node scripts/webui-check.js`。
