# CalMobile

CalMobile 是面向展会排期、详情展示、报名和审核的应用。当前版本以本地演示数据为主，已经具备普通用户、展商和管理员的核心操作链路；前端由 WebView 承载 `newUI/` 的 17 屏设计，Android 侧保留业务与系统能力。

## 文档入口

- `README.md`：唯一的产品说明、需求、架构、界面规范、验收场景和路线图。
- `AGENTS.md`：贡献者与自动化代理的工作约定。
- `server/README.md`：Node.js 服务的数据库配置、启动方式和 API 目录。
- `newUI/`：设计交付件（`index.html`、`remaining-ui.html`、`ui-spec.md`、`DESIGN-HANDOFF.md`、`DESIGN-MANIFEST.json`），是界面标准的来源。

历史上的 `TODO.md`、`MOBILE_REQUIREMENTS.md`、`docs/MOBILE_REQUIREMENTS.md`、`ARCHITECTURE.md`、`DESIGN.md`、`docs/PROJECT_REVIEW.md` 和 `AGENT.md` 已在本文件中合并，避免同一需求出现多份版本。

## 产品范围与角色

应用支持访客浏览，登录后根据账号角色显示功能：

- 普通用户：浏览月历、查看展会详情、填写报名、取消报名、维护个人资料和查看公开主页。
- 展商：创建、编辑、删除自己的展会，维护分类、日期、时间、简介和报名收集项，查看报名并执行通过/拒绝审核。
- 管理员：管理用户和全部展会，暂停/恢复报名、导出 CSV，并设置应用配色、启动公告、展会分类、重新审核开关以及富文本媒体限制。

首页提供按月日历、当天展会卡片、顶部搜索和按角色显示的底部导航（首页、我的报名、展商、管理、个人）。展会详情与报名表单是独立页面；展商状态选择、报名审核在内嵌面板中展开，面板紧邻触发卡片。

## 前端架构（WebView 承载 newUI）

前端由 WebView 承载，页面资源位于 `app/src/main/assets/web/`，通过自定义域名映射到 `https://appassets.androidplatform.net/assets/web/`，保持标准 Web 安全上下文（`fetch`、ES 模块、`localStorage` 可用）。

```text
app/src/main/
├── assets/web/
│   ├── index.html              外壳与资源入口
│   ├── styles/tokens.css       newUI 设计令牌（颜色/字号/间距/圆角/动效）
│   └── js/
│       ├── app.js              路由注册与应用启动
│       ├── core/               bridge.js（原生桥）、router.js（哈希路由与导航）、dom.js、sanitize.js
│       ├── ui/components.js    顶部栏、卡片、分段控件、状态块、弹层、轻提示
│       └── pages/*.js          17 个页面模块，一屏一文件
├── java/com/example/calmobile/
│   ├── WebShellActivity.java   WebView 容器：资源拦截、返回栈、结果与权限转发
│   ├── WebAppBridge.java       JavaScript 接口与回调分发
│   ├── WebAppActions.java      业务动作实现（复用现有 Manager / Helper）
│   ├── RegistrationReviewStore.java  报名审核记录（旧页面与新前端共用）
│   ├── UserProfileStore.java   个人资料与公开策略持久化
│   └── legacy/                 旧 Java/XML 页面，保留编译与清单注册，仅用于对照与回退
```

桥接协议：前端调用 `CalMobileNative.invoke(action, payloadJson, callbackId)`，原生处理完成后回调 `window.CalMobileBridge.onResult(callbackId, ok, result, error)`。前端只使用 `js/core/bridge.js` 的 `call(action, payload)`，异常统一抛出 `Error` 由页面就地展示。

页面与设计稿编号的对应关系：

| 编号 | 页面模块 | 说明 |
| --- | --- | --- |
| 01 | `pages/login.js` | 登录 / 访客入口 |
| 02 | `pages/home.js` | 月视图与当天展会 |
| 03 | `pages/detail.js` | 展会详情、加入日历、分享 |
| 04 | `pages/registration-form.js` | 报名信息 |
| 05 | `pages/register.js` | 创建账号 |
| 06 | `pages/search.js` | 搜索展会 / 地点 / 用户 |
| 07 | `pages/my-registrations.js` | 我的报名 |
| 08 | `pages/registration-detail.js` | 报名详情与撤销 |
| 09 | `pages/profile.js` | 个人主页与公开策略 |
| 10 | `pages/exhibitor.js` | 展商后台 |
| 11 | `pages/exhibition-form.js` | 展会编辑（含报名方式与收集项） |
| 12 | `pages/rich-editor.js` | 富文本简介与媒体 |
| 13 | `pages/review.js` | 报名管理 / 审核 |
| 14 | `pages/user-public.js` | 用户公开页 |
| 15 | `pages/admin.js` | 管理后台 |
| 16 | `pages/admin-exhibitions.js` | 展会管理、暂停报名、导出 CSV |
| 17 | `pages/admin-settings.js` | 系统设置 |

### 界面标准

- 沿用 newUI 令牌：背景 `#F7F6F3`、页面白色、主文字 `#20252B`、次文字 `#626A74`、弱化文字 `#969DA7`、描边 `#C5CAD1`、主按钮 `#48515D`、强调色 `#C05621`（可由管理员配色覆盖）。
- 线框以 216×480 的手机框绘制，生产版按 390dp 逻辑宽度等比例换算（约 ×1.8）：正文 16px、标题 26px、控件高 48px、圆角 8/12/16/20px。
- 触控区域不小于 44px；状态始终同时使用文字与颜色；空、加载、错误、成功状态在原位置给出下一步说明。
- 日期、时间、状态和报名方式使用选择器、分段控件或内嵌面板，不使用下划线输入框。
- 富文本渲染前统一经过 `js/core/sanitize.js` 白名单清洗。

## 已实现的关键交互

### 展会创建与详情

`pages/exhibition-form.js` 维护名称、地点、开展日期与时间、报名起止日期、分类和报名方式（需审核 / 无需审核 / 仅展示，另保留截止报名与已结束）。保存前校验必填项与报名截止日期先后关系，保存后可就地新增或删除报名收集项，收集项支持文本、单选、多选、必填与选项内容。

展会简介通过 `pages/rich-editor.js` 编辑：加粗、斜体、标题、列表、引用、链接、分割线与插入图片，图片数量与单张大小受系统设置限制；详情页按清洗后的富文本渲染。

报名页只渲染展商配置的收集项，未配置时使用默认三项；必填项缺失时在表单内提示并聚焦对应字段，提交成功后显示成功状态并跳转“我的报名”。

### 个人、展商与管理页

个人页可直接编辑昵称、邮箱、简介、联系方式与社交账号，并切换“展示我的报名”公开策略；通知与提醒开关写入 `NotificationHelper` 偏好，未授权时可一键申请系统通知权限。

展商后台每张展会卡片提供查看报名、编辑展会、报名方式、编辑简介和删除。报名管理按待审核 / 已通过 / 已拒绝 / 全部筛选，点击记录在底部面板查看完整回答并通过或拒绝；已审核记录是否可再次修改由管理员的“允许修改已通过或已拒绝的报名”开关决定。

管理后台按用户 / 展会 / 设置分区：用户可改状态与查看公开页，展会可暂停或恢复报名（展商不能自行恢复），系统设置集中维护配色、公告、分类、审核策略与媒体限制。导出 CSV 通过系统文件选择器写入。

## 架构与数据边界

业务层继续使用现有 Java 组件，WebView 前端通过 `WebAppActions` 调用，不复制业务规则：

| 组件 | 职责 |
| --- | --- |
| `ExhibitionManager` + `DatabaseHelper` | 展会增删改查、状态变更、示例数据播种 |
| `RegistrationManager` | 报名提交、列表与撤销 |
| `RegistrationReviewStore` | 审核状态与报名人记录（会话内，旧页面与新前端共用） |
| `AdminUserManager` | 用户列表、搜索与账号状态 |
| `AuthManager` | 登录、注册、访客与角色权限 |
| `AppSettings` + `UserProfileStore` | 主题、公告、分类、审核开关、媒体限制、个人资料 |
| `CalendarHelper` / `NotificationHelper` / `ExportManager` | 系统日历、通知与 CSV 导出 |

数据库不可用时各 Manager 回退到内存示例数据；`ExhibitionCatalog` 保存首页示例展会的月份、展商与亮点信息。Room、Retrofit、Repository、ViewModel 与 `server/` 已有骨架，但尚未替换本地演示数据源。

逻辑对象包括：

| 对象 | 主要内容 |
| --- | --- |
| Exhibition | 名称、地点、日期、时间、状态、分类、HTML 简介、展商 |
| Registration | 展会、报名人、提交时间、审核状态、表单回答 |
| RegistrationField | 标题、类型（文本/单选/多选）、选项、必填 |
| User | 昵称、邮箱、简介、联系方式、角色、账号状态、公开策略 |
| AppSettings | 配色、启动公告、分类、审核后是否可修改、媒体限制 |

## 技术选型与权限

Android 依赖集中在 `app/build.gradle`：AndroidX、Material、`richeditor-android`（旧页面使用）、Room、Retrofit/OkHttp、Gson、Glide、JUnit 和 Espresso。WebView 容器只使用平台 API，不额外引入 `androidx.webkit`，资源映射由 `WebShellActivity` 自行实现。

应用声明 `POST_NOTIFICATIONS` 以及读写系统日历所需权限；首次使用日历或通知功能时由前端发起申请，授权后继续执行原操作，拒绝时页面保留可用的浏览与报名流程。

### 原生界面与 WebView 的取舍

本版本已经把界面迁移到 WebView，原生 Activity 全部归档到 `legacy/` 并保留编译与清单注册，仅用于对照与回退。选择 WebView 的原因是：`newUI/` 交付件本身就是 HTML/CSS，直接复用可保证视觉一致；页面模块化后改动集中在 `assets/web`，无需重新编译 XML 布局。

代价与边界：离线资源由 APK 内置，媒体文件仍保存在设备本地；JavaScript 与 Android 返回栈通过 `history` 与 `WebView.canGoBack()` 同步；文件选择、日历写入、通知权限、CSV 导出和分享通过桥接调用系统界面；富文本编辑器改为 Web 实现，旧页面的 `RichEditor` 仍保留在 `legacy/`。

## 构建、测试与运行

环境要求：Android Studio、JDK 17、Android SDK 34、Gradle Wrapper 8.5；Windows 命令如下，Linux/macOS 将 `gradlew.bat` 换为 `./gradlew`。

```bash
# 结构检查（清单、桥接契约、17 屏页面文件、设计令牌、文档）
node scripts/smoke-check.js

# 前端静态检查（ES 模块解析、动作名与页面文件一致性）
node scripts/webui-check.js

# Android 单元测试与调试 APK
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug

# 运行指定测试
gradlew.bat :app:testDebugUnitTest --tests 'com.example.calmobile.CalendarHelperTest'
```

后端开发请进入 `server/`，按 `server/README.md` 创建 PostgreSQL 数据库并复制 `.env.example`；常用命令为 `npm install`、`npm run db:migrate`、`npm run db:seed`、`npm run dev`、`npm test -- --runInBand` 和 `npm run lint`。

客户端测试位于 `app/src/test/java/com/example/calmobile/`，覆盖认证、数据库、展会、报名、用户管理、导出、通知、日历、富文本和搜索等 Manager/Helper 流程；Activity 级 UI 测试仍在路线图中。

可用模拟器时，可安装并逐屏回归：

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.example.calmobile/.WebShellActivity

# 仓库内提供的回归辅助脚本（截图、按可见文字点击、查看日志）
pwsh -File scripts\emu.ps1 install
pwsh -File scripts\emu.ps1 shot .omo\evidence\02-home
pwsh -File scripts\emu.ps1 tap-text "以访客身份浏览"
pwsh -File scripts\emu.ps1 logs
```

预置演示账号：`demo/password`（管理员）、`exhibitor/password`（展商）、`user/password`（普通用户）；未登录用户只能浏览公开展会详情。

## 验收场景

1. 普通用户在月历左右切换月份，点击日期和展会卡片进入详情，填写展商配置的报名项并提交。
2. 展会处于仅展示、截止报名、已结束状态时，详情页禁用报名并说明原因；访客点击报名会先引导登录，登录后回到原展会。
3. 展商在展商后台新建展会，选择日期与报名方式，进入富文本编辑器插入文字与图片，保存后在详情页看到渲染结果。
4. 展商或管理员打开报名管理，筛选待审核记录，在底部面板查看回答并通过或拒绝；管理员开启“允许重新审核”后可再次修改。
5. 管理员切换配色、编辑公告与分类、调整媒体限制，保存后全应用配色与富文本编辑器提示同步更新，重启后仍生效。

## 路线图与已知限制

- 后端 API 未接入：展会、报名、审核与资料仍以本地 SQLite、会话内存储和 SharedPreferences 为准，重启应用后审核记录与登录态不会保留。
- 视频上传待服务端接口：富文本编辑器可调用系统选择器，但不做真实上传与转码。
- 媒体限制只作用于编辑器提示与数量校验，媒体文件仍保存在设备本地。
- 旧 `legacy/` 页面与新前端共用 `RegistrationReviewStore`，删除旧页面时需同步检查该引用。
- 认证仍是明文比对的内置账号，缺少密码哈希与安全持久化。
- 继续补齐前端页面的无障碍检查与深色主题，并把剩余硬编码文案迁移到 `strings.xml`。

## 冲突与待裁决清单

迁移中遇到“设计稿要求”与“现有业务/数据模型”不一致的地方，按“以线框为准、缺的能力在桥接层补齐”的原则处理，以下条目需要确认：

| 条目 | 现状处理 | 需要确认 |
| --- | --- | --- |
| 报名方式“需审核 / 无需审核 / 仅展示” | 新增状态常量并入库；`报名中` 在界面上按“需审核”展示 | 是否需要数据迁移，把历史 `报名中` 记录改写为具体方式 |
| “无需审核”的自动通过 | 目前仍写入待审核记录，由展商手动通过 | 是否需要提交即置为已通过 |
| 报名收集项持久化 | 仍保存在 `ExhibitionConfiguration` 会话内 | 是否纳入 SQLite 表结构 |
| 报名审核记录 | 仍为会话内存储 | 是否纳入 SQLite 表结构 |
| 首页示例展会 | 首页展示 SQLite 中的 4 条展会，`ExhibitionCatalog` 提供月份/展商/亮点补充 | 是否把首页 7 条样例一并写入数据库 |
| “修改报名” | 打开报名页并回填已提交的回答，保存时受“已提交过该展会”限制 | 是否需要真正的报名更新接口 |
| 视频上传 | 仅有系统选择器占位 | 是否接入服务端媒体接口 |
| 管理员角色 | 继续用 `admin` 覆盖超级管理员 | 是否需要独立超级管理员 |

## 变更记录

- 2026-09-14：前端迁移到 WebView，按 `newUI/` 的 17 屏拆分页面模块，新增 `WebAppBridge`/`WebAppActions` 桥接层，旧 Activity 归档到 `legacy/`。
- 2026-09-14：按 newUI 灰盒规范重构颜色、卡片、表单、首页月历、详情分享、搜索跳转和我的报名列表。
- 2026-09-14：合并重复 Markdown，更新 API 34、富文本编辑、日期时间选择、四项导航、管理员设置和当前限制。
- 2026-09-14：完成展会简介二级富文本编辑器、图片插入以及报名起止日期并排选择。
