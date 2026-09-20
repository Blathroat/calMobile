# Repository Guidelines

## 项目结构

Android 客户端位于 `app/`，使用 Java 17。启动页是 `WebShellActivity`，它是承载 `newUI/` 设计的 WebView 容器；前端页面、样式与脚本位于 `app/src/main/assets/web/`，原生侧**只剩系统能力**（`app/src/main/java/com/example/calmobile/`：系统日历、通知与摄像头权限、媒体选择与落盘、分享、导出、系统栏配色）。业务数据（展会、报名、用户、认证、设置）全部由 `server/` 的 Express + PostgreSQL 后端提供，原生不再持有任何数据实现。旧 Java/XML 页面已随 WebView 迁移删除，界面只有 `WebShellActivity` 一个入口；`res/` 只保留 `AppTheme` 与应用名/日历提示等原生必需资源，前端文案在 `res/values/strings_frontend.xml`（由 `scripts/extract-strings.js` 生成）。单元测试在 `app/src/test/`。`server/` 是独立的 Node.js、Express 与 PostgreSQL 服务，不属于 Gradle 模块。项目说明、架构、需求、设计令牌和路线图统一维护在根目录 `README.md`，后端运行细节维护在 `server/README.md`。

## 构建、测试与开发

在仓库根目录运行：

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

`smoke-check` 校验清单入口、桥接契约、页面模块、设计令牌、动效层、内置依赖与文档关键内容；`webui-check` 校验前端 ES 模块能否解析、动作名与原生系统动作白名单；`webui-render.test.js` 用最小 DOM 打桩与假后端 `fetch` 把每个页面真正渲染一次，捕获只在运行时才暴露的接线错误（新增页面或接口后要同步补上约定返回值与用例）；`check-strings.js` 校验前端文案在源码、`strings_frontend.xml` 与 `FrontendStrings.NAMES` 三处一致，并拦下「文案资源首尾带空白」这种在真机上会被 Android 裁掉的写法；`server/test/api.test.js` 是前后端契约测试，逐接口断言页面用到的字段都在，并交叉校验前后端路由一致；`smoke-check.test.js` 是检查脚本自身的单元测试。POSIX 环境使用 `./gradlew`。后端进入 `server/` 后运行 `npm install`、`npm run db:migrate`、`npm run db:seed`、`npm run dev`；测试使用 `npm test -- --runInBand` 与 `npm run test:contract`，风格检查使用 `npm run lint`；数据库跑在 Docker 里（`pwsh -File scripts\db.ps1 start`），配置参考 `server/.env.example`，禁止提交 `.env`、密钥或真实用户数据。后端起来后先看 `http://127.0.0.1:3000/status` 确认各检查项。

## 编码与界面规范

Java 使用四空格缩进；类名使用 PascalCase，方法、变量使用 camelCase，资源名使用 `snake_case`。前端 CSS 类使用 kebab-case，页面模块使用 kebab-case 文件名。用户可见文案统一进 `res/values/strings_frontend.xml`（改前端源码后跑 `node scripts/extract-strings.js --write`），页面里用 `t('key')` 取用，不要写死中文字面量；**文案资源不得以空白开头或结尾**（Android 的 `<string>` 会裁掉首尾空白，而 JS 侧原样保留，靠它做间隔在真机上会粘在一起——`check-strings.js` 会拦下这种写法，间隔请用标点或由代码拼接）；新增文档和注释使用中文。沿用 newUI 令牌（`#F7F6F3` 背景、`#FFFFFF` 页面、`#20252B` 主文字、`#626A74` 次文字、`#C5CAD1` 描边、`#48515D` 主按钮、`#C05621` 强调色），颜色、字号、间距、圆角只在 `styles/tokens.css` 声明，交互动效只在 `styles/motion.css` 声明，页面不重复定义；强调色只能通过 `--accent*` 变量使用，不得写死具体色值，否则管理员配色会失效。线框尺寸按 390dp 逻辑宽度等比换算，触控区域不小于 44px；展会图片按设计稿的 1080×1920（9:16）竖向比例展示；顶部导航栏统一使用 `--topbar-h` 高度，不要在标题下加装饰线。并排字段用 `.grid-cols-2`（flex 等高）保证输入框对齐。日期、时间和状态选择使用选择器、分段控件或页内面板，不使用下划线输入框；切换类控件使用 `segmented()` 的滑动滑块，不重建 DOM。动态展开内容必须出现在触发卡片附近，并提供选中、禁用、错误、加载和完成反馈。Markdown 与 HTML 渲染前必须经过 `js/core/sanitize.js` 清洗，渲染 Markdown 用 `core/markdown.js` 的 `renderMarkdown`（会自动按需加载引擎）。第三方前端库必须内置到 `assets/web/vendor/` 并记录版本与许可证，不引用 CDN 或图标字体。

## 测试与提交

Android 改动按 smoke-check、webui-check、单元测试、调试构建的顺序验证；聚焦测试可使用 `:app:testDebugUnitTest --tests '包名.测试类'`。涉及界面时使用可用的模拟器进行 ADB 回归，仓库内可用 `pwsh -File scripts\emu.ps1` 完成安装、截图与按文字点击；**动效回归前先跑 `pwsh -File scripts\emu.ps1 motion check`**——设备的 `animator_duration_scale = 0` 会让 WebView 命中 `prefers-reduced-motion: reduce`，表现为「前端动效全没了」，那是设备开关不是代码问题。提交信息使用简洁中文动词短句，例如 `重构前端为 WebView`。合并请求需说明用户可见变化、验证命令和结果；界面改动附截图或录屏并关联问题。

## 架构与工作区

前端为 WebView 页面（HTML/CSS/ES 模块），数据一律通过 `js/core/api.js` 走后端 HTTP（`server/`，Express + PostgreSQL）；原生只剩下「只有设备能做」的系统能力，动作表固定为 `ui.sync`、`camera.ensurePermission`、`calendar.status`、`calendar.toggle`、`notify.requestPermission`、`media.pickImage`、`media.import`、`media.store`、`share.text`、`export.csv` 十个（`WebAppActions.handle()` 的 switch 就是权威清单），**不要往原生加数据实现**。系统动作的入参一律用后端下发的原值：日历按 ISO 日期（`YYYY-MM-DD`）定位，缺日期或格式非法就报错，**不要猜年月、也不要把缺省值当 1 号**；动作失败必须走 `callback.failure`，不要把「没写成」回报成成功（`calendar.toggle` 曾因此让按钮翻转却没写进日历）。`AppSettings` 只是设备侧的镜像（外观模式、配色下标、媒体上限、系统栏颜色），权威值在后端，由 `ui.sync` 推过来。新增页面时同时更新 `assets/web/js/app.js` 的路由注册、`README.md` 的屏幕对照表和 `scripts/smoke-check.js`、`scripts/webui-check.js` 的页面清单；管理类功能优先内联到现有页面，不新增二级页面。管理员在「管理-设置」中维护的是服务器级配置（软件中英文标题、公告、分类、审核策略、媒体与上传限制、表单字符数上限），保存在后端 `app_settings` 表里、对所有用户生效；应用配色与外观模式属于个人偏好（`users.ui_mode`）。表单校验统一走 `js/core/validate.js`，长度上限取自 `state.limits`，后端保存前再校验一次；用户可见文案统一走 `core/strings.js` 的 `t('key')`，文案本体在 `res/values/strings_frontend.xml`。前端取数按 `js/core/api.js` 的 `ENDPOINTS` 表把动作翻成 REST 请求，没有原生降级路径：后端连不上就直接报错（数据只在后端）。页面渲染数据统一用 `js/core/loadable.js` 的 `loadInto()`——命中缓存同步出内容、容器非空时不清空只标 `data-busy`、数据没变不重绘，且必须有「这次加载是否过期」的守卫（用户连续切月/切筛选时旧响应不能覆盖新视图）；不要在页面里写「先 `loadingBlock()` 再 await」的老写法，也不要在页面里自己 `catch` 后画错误块。**取数失败必须让用户看见**：不要用 `Promise.allSettled` 吞掉错误后照常渲染，也不要让「未知」在界面上显示成「已授权/已开启」。预加载集中在 `js/core/preload.js`（标签页、相邻月份、列表首项详情、`warmOnPress()`），由 `app.js` 在路由变化后触发，去重键要带上解析后的参数。后端改动：状态一律在库里存英文代码、中文标签只在 `server/src/domain/labels.js` 映射一次；写入类接口返回 `{ ok, error, ... }` 信封（页面按 `.ok` 判断），读取类直接返回数据；可预期的规则失败用 200 + `ok:false`，认证授权用 4xx，**数据库不可用用 503**（`domain/errors.js` 的 `isDatabaseUnavailable()`），错误正文不回传 pg 原文、SQL 或堆栈；公开接口不要下发 `checkInCode` 这类凭据；新增接口要同时补 `api.js` 的 `ENDPOINTS`、后端路由与 `server/test/api.test.js`（那里有前后端路由交叉校验）。**邮件与验证码**：发信走 `server/src/services/mailer.js` 的 `console` / `smtp` / `memory` 三条通道（开发用 Mailpit：`pwsh -File scripts\mail.ps1 start`，收件箱 8025），**不要在应用服务器上自建 SMTP**（25 端口被封、没有 IP 信誉，验证码会进垃圾箱）；发码接口一律「先落库、立刻回包、后台发信」——前端请求超时是 3 秒，同步等一次 SMTP 往返会超时；发信结果写 `mail_log`，失败要让用户看得见（`/status` 的「邮件通道」自检项读的就是它，不做实时 SMTP 握手）；验证码只存哈希、单码限次、限流落库（内存窗口重启就归零）；邮件文案在 `services/mail-templates.js`（后端渲染，不进 `res/values/strings_frontend.xml`），品牌名这类来自管理员设置的字段进 HTML 前转义、进邮件头前清换行。**邮箱是身份**：它唯一（大小写无关、空串除外）且必须验证过，因此改邮箱只能走「验证码发到新地址、通过才落库」两步（`PUT /profile` 不再接受 `email` 字段），`users.email` 的写入点只有注册、改邮箱与 seed；**登录两步验证用预认证票**（`domain/preauth.js`，单次使用、只存哈希）：密码对了而码没过时**绝不能下发访问令牌或刷新令牌**，否则两步验证只是多一步表演。验证码与票据的失败要走「200 + `ok:false`」信封（与登录密码错误一致），限流才是 429。**第二因子有三种，并列可用**：验证器（TOTP）、邮箱验证码、备用码 —— 顺序与判定集中在 `domain/two-factor.js`，新增方式只改那里。TOTP 自己实现（`domain/totp.js`，零依赖）**必须对着 RFC 6238 官方向量写用例**；**验证器密钥加密存储**（AES-256-GCM，密钥来自 `TOTP_SECRET_KEY`，缺省借用 `JWT_REFRESH_SECRET`）而不是明文 base32，解不开时给「请重新绑定」而不是 500；**备用码只存 sha256、一次一枚、命中即原子消费**，重新生成时旧的全部作废，明文只在生成那一次响应里出现。开启两步验证时就要发一批备用码（手机与邮箱都用不了时的最后一道）；关闭时要把验证器绑定与备用码一起清掉。**绑了验证器就不要再自动发邮件码**（省一封多半用不上的信，也避开同一邮箱 60 秒一条的冷却），需要时由页面主动调 `/auth/login/code`。数据库跑在 Docker 里（`pwsh -File scripts\db.ps1 start`，容器 `calmobile-pg`），改了 `server/src/*.js` 要重启后端进程，Node 会继续用旧模块应答。**后端有两种运行模式**：`npm run dev` 是开发模式，`npm start` 自动进生产模式（脚本即 `node src/index.js --production`）——生产关掉 `/status` 与 `/api/v1/status`、启动前做配置自检（开发密钥/默认库密码/验证码只写日志等致命项拒绝启动）、对生产库迁移用 `npm run db:migrate:prod`。任何依赖 `NODE_ENV` 的新逻辑都必须读 `server/src/config/runtime.js` 的结论，并且 `index.js` / `config/migrate.js` 的第一行 require 必须是它（`config/mail.js`、`config/database.js` 都是在 require 那一刻就把值定下来的）。旧架构层（Room/Retrofit/Repository/ViewModel/legacy 页面、本机 SQLite 数据层、零依赖演示后端）已删除，不要重新引入。修改认证、持久化、导航、包名、签名或引入新框架前先确认。工作区可能包含其他任务的改动，只检查并提交本次涉及路径，不回退无关文件；`build/`、`.gradle-local/`、`.idea/`、`.omo/`、`.opencode/`、`node_modules/`、`.env`、日志与 APK 已在 `.gitignore` 中，不要把它们加入提交，也不要为了“干净”删除本机缓存目录。

## 文档维护

新增或更新需求先修改 `README.md`，不要再创建重复的需求、架构或 Review 文档。设计稿与实现的冲突记录在 `README.md` 的「冲突与待裁决清单」，未确认前不要擅自扩大数据模型。代码行为、依赖或命令变化后同步更新对应说明，并运行 `node scripts/smoke-check.js` 与 `node scripts/webui-check.js`。
