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
│   ├── styles/tokens.css       newUI 设计令牌（颜色/字号/间距/圆角）
│   ├── styles/motion.css       动效层：页面切换、抽屉、按压、悬浮、状态切换
│   ├── vendor/easymde/         内置 Markdown 编辑器（EasyMDE 2.21.0，MIT）
│   └── js/
│       ├── app.js              路由注册与应用启动
│       ├── core/               bridge.js（原生桥）、router.js（哈希路由与导航）、dom.js、sanitize.js、markdown.js、validate.js
│       ├── ui/components.js    顶部栏、卡片、分段控件、头像与裁剪、状态块、弹层、轻提示
│       └── pages/*.js          15 个页面模块，一屏一文件
├── java/com/example/calmobile/
│   ├── WebShellActivity.java   WebView 容器：资源与上传文件拦截、返回栈、结果与权限转发
│   ├── WebAppBridge.java       JavaScript 接口与回调分发
│   ├── WebAppActions.java      业务动作实现（复用现有 Manager / Helper）
│   ├── RegistrationReviewStore.java  报名审核记录（旧页面与新前端共用）
│   ├── UserProfileStore.java   个人资料（含地区、头像）与公开策略持久化
│   └── legacy/                 旧 Java/XML 页面，保留编译与清单注册，仅用于对照与回退
```

上传文件保存在应用私有目录 `files/media`，通过 `https://appassets.androidplatform.net/media/<文件名>` 引用；`WebShellActivity` 只放行该目录下的单层文件名，路径穿越一律拒绝。

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
| 09 | `pages/profile.js` | 个人主页、头像与设置（含管理员配色） |
| 10 | `pages/exhibitor.js` | 展商后台 |
| 11 | `pages/exhibition-form.js` | 展会编辑（封面上传、报名方式与收集项） |
| 12 | `pages/rich-editor.js` | Markdown 简介编辑（EasyMDE） |
| 13 | `pages/review.js` | 报名管理 / 审核 |
| 14 | `pages/user-public.js` | 用户公开页（入口在管理后台） |
| 15 | `pages/admin.js` | 管理后台（用户 / 展会 / 设置） |

设计稿中的 16「展会管理」与 17「系统设置」不再作为独立页面：搜索、暂停报名与导出 CSV 内联在管理后台的展会分区；启动公告、展会分类、审核策略、媒体与上传限制、字符数上限归入管理后台的「设置」分区（服务器设置，保存后对所有用户生效）；应用配色因为属于个人偏好，保留在个人页的「设置」栏。

### 界面标准

- 沿用 newUI 令牌：背景 `#F7F6F3`、页面白色、主文字 `#20252B`、次文字 `#626A74`、弱化文字 `#969DA7`、描边 `#C5CAD1`、主按钮 `#48515D`、强调色 `#C05621`（可由管理员配色覆盖）。
- 线框以 216×480 的手机框绘制，生产版按 390dp 逻辑宽度等比例换算（约 ×1.8）：正文 16px、标题 26px、控件高 48px、圆角 8/12/16/20px。
- 触控区域不小于 44px；状态始终同时使用文字与颜色；空、加载、错误、成功状态在原位置给出下一步说明。
- 日期、时间、状态和报名方式使用选择器、分段控件或内嵌面板，不使用下划线输入框。
- Markdown 与富文本渲染前统一经过 `js/core/sanitize.js` 白名单清洗。

### 动效标准

`styles/motion.css` 集中声明交互动效，参照 `newUI/remaining-ui.html` 的状态语义，只动画 `transform` 与 `opacity`，并统一受 `prefers-reduced-motion` 保护：

| 场景 | 表现 |
| --- | --- |
| 页面切换 | 前进右侧滑入、返回左侧滑入，标题同步上浮（280ms / `ease-out`） |
| 列表与卡片 | 依次淡入上移，最多排队 8 项，避免长列表等待 |
| 抽屉与面板 | 背景淡入 + 面板从底部弹起，关闭时先播放退场动画再移除（340ms） |
| 按钮 | 悬浮上浮 1px 加投影，按下缩放到 0.975 并出现径向波纹 |
| 分段控件 | 选中态是一个滑块，切换时从上一个按钮滑动到目标按钮，不重建 DOM |
| 底部导航 | 选中指示条滑到目标标签，图标轻微弹跳 |
| 首页日历 | 拖动跟手位移并投影加深，松手回弹或滑出滑入切换月份 |
| 状态反馈 | 状态标签弹出、成功状态图标缩放出现、轻提示弹出后淡出 |

### 配色作用范围

管理员选择的强调色写入 `--accent` 系列变量，统一驱动：主按钮与圆形主操作的填充、次按钮（保存配色 / 退出登录 / 上传头像这类）的边框、填充与文字、开关打开态、分段控件滑块、底部导航选中项、选中日期、顶部区块标题色条、聚焦光晕与事件圆点。页面与组件不得写死具体色值，否则改配色会失效。

顶部导航栏使用统一的 `--topbar-h` 高度，有无返回/操作按钮的页面高度一致；内容区是纵向滚动容器，因此固定高度的区块（如日历）不会被 flex 压缩而裁掉边框。

## 已实现的关键交互

### 展会创建与详情

`pages/exhibition-form.js` 维护名称、地点、开展日期与时间、报名起止日期、分类和报名方式（需审核 / 无需审核 / 仅展示，另保留截止报名与已结束）。并排字段用 flex 等高对齐，提示文案贴底不撑高输入框；保存前校验必填项、长度上限、时间格式与报名截止日期先后关系。

展会封面独立成一张卡片，按设计稿的 1080×1920（9:16）竖向比例展示，可通过系统选择器上传，超过大小上限时自动等比压缩后再落盘。

报名收集项支持文本、单选、多选与必填；选择单选或多选后可逐条“添加选项 / 删除选项”，不再要求用英文逗号手写分隔。删除全部收集项后报名页回退到默认三项。

展会简介通过 `pages/rich-editor.js` 编辑，使用内置的 EasyMDE（Markdown）提供标题、加粗、斜体、引用、清单、链接、表格、实时预览与插图；剪贴板里是 Markdown 时直接写入编辑器，也可通过“粘贴 Markdown”面板选择替换或追加。简介以 Markdown 源码保存，详情页按 Markdown 渲染（`core/markdown.js` 在需要时按需加载 EasyMDE 内置的渲染函数）；历史 HTML 简介在打开编辑器时自动转换为 Markdown。

插图统一走 `media.import`：原生把图片压缩后写入应用私有目录 `files/media`，Markdown 里只保留 `![展会图片](https://appassets.androidplatform.net/media/xxx.jpg)` 短 URL，保存时还会把历史内容里的内联 base64 图片自动改写成同样的短 URL，长简介不再因为 base64 而变慢。

“无需审核”的展会提交报名后直接置为已通过，报名页与“我的报名”都会显示已通过，展商仍可在报名管理中调整；需审核的展会保持待审核。

### 个人、展商与管理页

个人页可直接编辑昵称、邮箱、简介、地区与社交账号，并支持上传头像：选择图片后进入圆形裁剪面板（拖动平移、滑块缩放），确认后用 canvas 导出 512×512 图片并落盘成短 URL。「设置」栏集中通知与提醒开关，管理员在此额外维护应用配色。

配色保存后立即生效，并驱动顶部标题短线、区块标题色条、分段控件滑块、选中日期、底部导航与聚焦光晕，因此改配色在触屏上也能立刻看到整屏变化；默认色号与设计稿的强调色一致（`#C05621`）。

展商后台每张展会卡片提供查看报名、编辑展会、报名方式、编辑简介和删除。报名管理按待审核 / 已通过 / 已拒绝 / 全部筛选（滑块式分段控件），点击记录在底部面板查看完整回答并通过或拒绝；已审核记录是否可再次修改由“允许修改已通过或已拒绝的报名”开关决定。

管理后台按用户 / 展会 / 设置分区，切换时滑块平滑移动：用户可改状态与查看公开页；展会可直接搜索、查看报名、编辑、暂停或恢复报名（展商不能自行恢复）并导出 CSV；设置为服务器级配置，保存后对所有用户生效，包括软件中英文标题、启动公告、展会分类、审核策略、富文本媒体限制、上传格式与大小限制（图片/视频后缀、头像大小）以及各类表单字符数上限。

软件标题在「管理-设置」里分别维护中文与英文：中文标题显示在首页上方（默认“发现展会”）与登录页的应用名称位置，英文标题显示在首页、我的报名、报名管理等页面的品牌行，同时用于浏览器标题。

### 表单校验

`js/core/validate.js` 统一实现必填、长度、格式与跨字段校验，长度上限来自服务器设置（`state.limits`），并在字段下方给出字数计数与内联错误。覆盖登录、注册、修改密码、编辑资料、展会编辑、报名填写等表单；原生侧保存前会再校验一次，避免绕过页面直接调用桥接。

## 架构与数据边界

业务层继续使用现有 Java 组件，WebView 前端通过 `WebAppActions` 调用，不复制业务规则：

| 组件 | 职责 |
| --- | --- |
| `ExhibitionManager` + `DatabaseHelper` | 展会增删改查、状态变更、示例数据播种 |
| `RegistrationManager` | 报名提交、列表与撤销 |
| `RegistrationReviewStore` | 审核状态与报名人记录（会话内，旧页面与新前端共用） |
| `AdminUserManager` | 用户列表、搜索与账号状态 |
| `AuthManager` | 登录、注册、访客与角色权限 |
| `AppSettings` + `UserProfileStore` | 服务器设置（公告、分类、审核策略、媒体与上传限制、字符数上限）、应用配色与个人资料（含地区、头像） |
| `CalendarHelper` / `NotificationHelper` / `ExportManager` | 系统日历、通知与 CSV 导出 |

数据库不可用时各 Manager 回退到内存示例数据；`ExhibitionCatalog` 保存首页示例展会的月份、展商与亮点信息。Room、Retrofit、Repository、ViewModel 与 `server/` 已有骨架，但尚未替换本地演示数据源。

逻辑对象包括：

| 对象 | 主要内容 |
| --- | --- |
| Exhibition | 名称、地点、日期、时间、状态、分类、HTML 简介、展商 |
| Registration | 展会、报名人、提交时间、审核状态、表单回答 |
| RegistrationField | 标题、类型（文本/单选/多选）、选项、必填 |
| User | 昵称、邮箱、简介、地区、头像、角色、账号状态、公开策略 |
| AppSettings | 配色、启动公告、分类、审核后是否可修改、媒体与上传限制、字符数上限 |

## 技术选型与权限

Android 依赖集中在 `app/build.gradle`：AndroidX、Material、`richeditor-android`（旧页面使用）、Room、Retrofit/OkHttp、Gson、Glide、JUnit 和 Espresso。WebView 容器只使用平台 API，不额外引入 `androidx.webkit`，资源映射由 `WebShellActivity` 自行实现。

前端唯一的第三方运行时依赖是 Markdown 编辑器 EasyMDE 2.21.0（MIT，内置 marked 与 CodeMirror 5），静态文件随 APK 打包在 `assets/web/vendor/easymde`，不依赖 CDN、图标字体或构建工具；版本与来源记录在该目录的 `VERSION.txt`。

应用声明 `POST_NOTIFICATIONS` 以及读写系统日历所需权限；首次使用日历或通知功能时由前端发起申请，授权后继续执行原操作，拒绝时页面保留可用的浏览与报名流程。

### 原生界面与 WebView 的取舍

本版本已经把界面迁移到 WebView，原生 Activity 全部归档到 `legacy/` 并保留编译与清单注册，仅用于对照与回退。选择 WebView 的原因是：`newUI/` 交付件本身就是 HTML/CSS，直接复用可保证视觉一致；页面模块化后改动集中在 `assets/web`，无需重新编译 XML 布局。

代价与边界：离线资源由 APK 内置，媒体文件仍保存在设备本地；JavaScript 与 Android 返回栈通过 `history` 与 `WebView.canGoBack()` 同步；文件选择、日历写入、通知权限、CSV 导出和分享通过桥接调用系统界面；简介编辑器改为内置 EasyMDE，旧页面的 `RichEditor` 仍保留在 `legacy/`。

## 构建、测试与运行

环境要求：Android Studio、JDK 17、Android SDK 34、Gradle Wrapper 8.5；Windows 命令如下，Linux/macOS 将 `gradlew.bat` 换为 `./gradlew`。

```bash
# 结构检查（清单、桥接契约、页面文件、设计令牌、动效层、内置依赖、文档）
node scripts/smoke-check.js

# 前端静态检查（ES 模块解析、动作名与页面文件一致性）
node scripts/webui-check.js

# 检查脚本自身的单元测试（启动入口解析等）
node --test scripts/smoke-check.test.js

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

### 仓库内容边界

下列内容属于本机环境或运行记录，已写入 `.gitignore`，不随代码分发；如果之前已被跟踪，用 `git rm -r --cached <路径>` 停止跟踪（文件仍保留在本地）：

| 路径 | 说明 |
| --- | --- |
| `build/`、`**/build/`、`*.apk`、`*.aab` | Gradle 构建产物 |
| `.gradle/`、`.gradle-local/`、`local.properties` | Gradle 缓存与本机 SDK 路径 |
| `.idea/`、`*.iml` | IDE 工程文件，由 IDE 自行生成 |
| `.omo/`、`.opencode/`、`.codegraph/` | 编码助手运行记录与本地工具缓存 |
| `*.log`、`captures/`、`*.hprof` | 日志与性能采样文件 |

`docs/screenshots/` 只保留课程报告脚本 `scripts/generate_report.py` 引用的 8 张界面截图；其余迭代过程中的重复截图与 UI dump 已清理。

## 验收场景

1. 普通用户在月历上左右滑动切换月份（六行月份自动多出一行），点击日期和展会卡片进入详情，填写展商配置的报名项并提交；填写超长内容时在字段下方看到字数与错误提示。
2. 展会处于仅展示、截止报名、已结束状态时，详情页禁用报名并说明原因；访客点击报名会先引导登录，登录后回到原展会。
3. 展商在展商后台新建展会，选择日期与报名方式；上传 1080×1920 竖版封面；收集项选到单选或多选后逐条增删选项；进入 Markdown 编辑器插入文字与图片，保存后在详情页看到渲染结果。
4. 展商或管理员打开报名管理，用滑块切换筛选，在底部面板查看回答并通过或拒绝；管理员开启“允许重新审核”后可再次修改；无需审核的展会提交后即为已通过。
5. 管理员在个人页的「设置」中切换配色并保存，主按钮、次按钮、开关、分段控件与底部导航同步换色；在管理后台的「设置」分区维护软件中英文标题、公告、分类、审核策略、媒体与上传限制、字符数上限，保存后首页品牌行与所有用户的表单校验、上传校验同步更新。
6. 普通用户在个人页上传头像，在圆形裁剪面板里拖动缩放后确认，头像立即更新并在用户公开页展示；「地区」字段在编辑资料表单与公开页保持一致。

## 路线图与已知限制

- 后端 API 未接入：展会、报名、审核与资料仍以本地 SQLite、会话内存储和 SharedPreferences 为准，重启应用后审核记录与登录态不会保留。
- 「服务器设置」目前保存在本机 SharedPreferences，界面按“保存后对所有用户生效”的语义呈现；接入服务端后应改为下发配置。
- 视频上传待服务端接口：Markdown 编辑器可调用系统选择器，但不做真实上传与转码。
- 媒体文件保存到应用私有目录 `files/media` 并通过短 URL 引用，仍属于设备本地存储；卸载应用会一并清除。
- 旧 `legacy/` 页面与新前端共用 `RegistrationReviewStore`，删除旧页面时需同步检查该引用。
- 认证仍是明文比对的内置账号，缺少密码哈希与安全持久化。
- 继续补齐前端页面的无障碍检查与深色主题，并把剩余硬编码文案迁移到 `strings.xml`。

## 冲突与待裁决清单

迁移中遇到“设计稿要求”与“现有业务/数据模型”不一致的地方，按“以线框为准、缺的能力在桥接层补齐”的原则处理，以下条目需要确认：

| 条目 | 现状处理 | 需要确认 |
| --- | --- | --- |
| 报名方式“需审核 / 无需审核 / 仅展示” | 新增状态常量并入库；`报名中` 在界面上按“需审核”展示 | 是否需要数据迁移，把历史 `报名中` 记录改写为具体方式 |
| “无需审核”的自动通过 | 提交后直接置为已通过，展商仍可在报名管理中调整 | 已按确认实现；如需改为“提交后仍待展商确认”请说明 |
| 报名收集项持久化 | 仍保存在 `ExhibitionConfiguration` 会话内，选项以英文逗号拼接后存储 | 是否纳入 SQLite 表结构 |
| 报名审核记录 | 仍为会话内存储 | 是否纳入 SQLite 表结构 |
| 简介存储格式 | 统一以 Markdown 保存并记录 `descriptionFormat`，历史 HTML 打开编辑器时自动转换，内联图片保存时改写为短 URL | 是否需要一次性把所有历史简介转换并回写 |
| 服务器设置生效范围 | 以 SharedPreferences 模拟服务端配置，界面已按“对所有用户生效”呈现 | 接入 `server/` 后是否改为服务端下发 |
| 首页示例展会 | 首页展示 SQLite 中的 4 条展会，`ExhibitionCatalog` 提供月份/展商/亮点补充 | 是否把首页 7 条样例一并写入数据库 |
| “修改报名” | 打开报名页并回填已提交的回答，保存时受“已提交过该展会”限制 | 是否需要真正的报名更新接口 |
| 视频上传 | 仅有系统选择器占位，格式与数量按服务器设置校验 | 是否接入服务端媒体接口 |
| 管理员角色 | 继续用 `admin` 覆盖超级管理员 | 是否需要独立超级管理员 |
| 设计稿 16/17 屏 | 内容内联到管理后台与个人页，不再保留二级页面 | 是否需要保留独立入口 |

## 变更记录

- 2026-09-14：应用配色扩展到主按钮填充、次按钮边框/填充/文字与开关打开态；新增软件中英文标题设置并显示在首页及其它品牌位；顶部导航栏统一高度并去掉标题下的强调短线；修复日历滑动切月后卡片被压缩导致下边框显示不全。
- 2026-09-14：无需审核的展会提交即通过；长简介图片改为落盘短 URL 并自动改写历史内联图片；服务器设置迁回「管理-设置」并新增上传格式与字符数上限；修复应用配色不生效并扩大强调色覆盖面；个人页去掉用户公开页入口、联系方式改为地区、新增头像上传与圆形裁剪；分段控件与底部导航改为滑动指示动效；展会图片统一为 1080×1920 竖向比例并支持上传封面；首页日历支持左右滑动切换月份并适配六行月份；所有表单补齐前端数据格式校验。
- 2026-09-14：加入动效层（页面切换、抽屉、按压、悬浮、状态切换），首页去掉重复入口，个人页合并设置栏，管理后台内联展会管理与系统设置，简介编辑器改用内置 EasyMDE（Markdown），收集项支持逐条增删选项，并排字段改为等高对齐。
- 2026-09-14：前端迁移到 WebView，按 `newUI/` 的页面拆分模块，新增 `WebAppBridge`/`WebAppActions` 桥接层，旧 Activity 归档到 `legacy/`。
- 2026-09-14：按 newUI 灰盒规范重构颜色、卡片、表单、首页月历、详情分享、搜索跳转和我的报名列表。
- 2026-09-14：合并重复 Markdown，更新 API 34、富文本编辑、日期时间选择、四项导航、管理员设置和当前限制。
- 2026-09-14：完成展会简介二级富文本编辑器、图片插入以及报名起止日期并排选择。
