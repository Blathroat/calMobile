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
| — | `pages/checkin.js` | 核销报名码（展商后台的现场工具，不占独立设计稿） |

设计稿中的 16「展会管理」与 17「系统设置」不再作为独立页面：搜索、暂停报名与导出 CSV 内联在管理后台的展会分区；启动公告、展会分类、审核策略、媒体与上传限制、字符数上限归入管理后台的「设置」分区（服务器设置，保存后对所有用户生效）；应用配色因为属于个人偏好，保留在个人页的「设置」栏。核销报名码同理，作为展商后台顶部入口的现场工具存在，没有对应的线框屏。

### 界面标准

- 沿用 newUI 令牌：背景 `#F7F6F3`、页面白色、主文字 `#20252B`、次文字 `#626A74`、弱化文字 `#969DA7`、描边 `#C5CAD1`、主按钮 `#48515D`、强调色 `#C05621`（可由管理员配色覆盖）。
- 线框以 216×480 的手机框绘制，生产版按 390dp 逻辑宽度等比例换算（约 ×1.8）：正文 16px、标题 26px、控件高 48px、圆角 8/12/16/20px。
- 触控区域不小于 44px；状态始终同时使用文字与颜色；空、加载、错误、成功状态在原位置给出下一步说明。
- 日期、时间、状态和报名方式使用选择器、分段控件或内嵌面板，不使用下划线输入框。
- Markdown 与富文本渲染前统一经过 `js/core/sanitize.js` 白名单清洗。
- 焦点环只在键盘导航（`:focus-visible`）时出现：点击开关、分段控件、日历日期这类按钮不会在周围闪出系统高亮方框；日历的选中日期不用方框，而是「强调色加粗数字 + 数字下方一小段下划线」。
- 二维码固定白底黑点，不跟随深色模式反色，否则部分扫码器无法识别。

### 深色模式

个人页「设置」栏提供「跟随系统 / 浅色 / 深色」三选一（`settings.uiMode`，保存在本机 SharedPreferences），`js/core/bridge.js` 的 `applyMode` 把结果写进 `<html data-mode>`，`styles/tokens.css` 用同一组令牌的深色取值接管全部颜色，因此页面与组件无需逐页适配。`index.html` 的内联脚本会在样式表生效前先落到 localStorage 里缓存的模式，避免首帧闪白；选择「跟随系统」时由 `prefers-color-scheme` 与 `matchMedia` 的 `change` 事件驱动。强调色的衍生值（`--accent-ink`、`--accent-tint`、`--accent-edge`）在深色下改为与深色页面底混色，保证对比度。原生侧同步把状态栏、导航栏与 WebView 底色切到深色取值（`AppSettings.isDarkMode` / `getScreenColor`）。

### 配色作用范围

管理员选择的强调色写入 `--accent` 系列变量，统一驱动：主按钮与圆形主操作的填充、次按钮（保存配色 / 退出登录 / 上传头像这类）的边框与文字、开关打开态、分段控件滑块、底部导航选中项、选中日期、顶部区块标题色条、聚焦光晕与事件圆点。页面与组件不得写死具体色值，否则改配色会失效。

次按钮、状态标签、通知条这类「浅色底深色字」的控件，其浅色底一律取 `--accent-tint`，而该变量被定义为当前页面底色（浅色模式下就是白色 `#FFFFFF`，深色模式下是深色页面底），因此应用配色只改变它们的边框与字体颜色，底色始终与页面背景一致。填充强调色的控件（`.cta`、`.round-action`、选中日期、分段滑块）使用 `--on-dark` 作为文字色，保证深浅两种模式下的对比度。

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

个人页可直接编辑昵称、邮箱、简介、地区与社交账号，并支持上传头像：选择图片后进入圆形裁剪面板，单指拖动平移、双指捏合缩放（桌面或鼠标环境用滚轮代替第二根手指），面板实时显示当前倍数，确认后用 canvas 导出 512×512 图片并落盘成短 URL。「设置」栏集中通知与提醒开关，以及深色模式选择，管理员在此额外维护应用配色。

配色保存后立即生效，并驱动区块标题色条、分段控件滑块、选中日期、底部导航与聚焦光晕，因此改配色在触屏上也能立刻看到整屏变化；默认色号与设计稿的强调色一致（`#C05621`）。

展商后台每张展会卡片只保留「查看报名」与「编辑展会」两个入口，顶部提供「核销报名码」与「新建展会」；报名方式、编辑简介、启用报名二维码与删除展会都收进「编辑展会」二级界面的「报名与简介设置」栏，卡片保持清爽。从管理后台的展会卡片进入报名管理时，返回按钮回到管理后台而不是展商后台。

报名管理按待审核 / 已通过 / 已拒绝 / 已参加 / 全部筛选（滑块式分段控件），点击记录在底部面板查看完整回答并通过、拒绝或标记为已参加；展商能否再次修改已审核记录由「允许修改已通过或已拒绝的报名」开关决定，管理员在管理后台查看报名时始终可以切换报名人状态，不受该开关影响。

管理后台按用户 / 展会 / 设置分区，切换时滑块平滑移动，当前分区写进地址栏（`#/admin?tab=展会`）并用模块级变量兜底，因此从展会卡片进二级页面再返回时仍停在「展会」而不是跳回「用户」：用户可改状态与查看公开页；展会可直接搜索、查看报名、编辑、暂停或恢复报名（展商不能自行恢复）并导出 CSV；设置为服务器级配置，保存后对所有用户生效，包括软件中英文标题、启动公告、展会分类、审核策略、富文本媒体限制、上传格式与大小限制（图片/视频后缀、头像大小）以及各类表单字符数上限。

管理后台的「公开页」按钮进入用户公开页时，页面顶部标注「管理视角」并展示该用户的完整已参加展会记录，不受用户「展示我的报名」隐私设置限制；普通访问者从展会详情进入时仍按该设置过滤。

软件标题在「管理-设置」里分别维护中文与英文：中文标题显示在首页上方（默认“发现展会”）与登录页的应用名称位置，英文标题显示在首页、我的报名、报名管理等页面的品牌行，同时用于浏览器标题。

### 报名二维码与现场核销

展会在「编辑展会 → 报名与简介设置」里通过「启用报名二维码」开关控制是否发放报名码（`ExhibitionConfiguration.registrationQrEnabled`）。启用后：

1. 用户的报名审核通过（或“无需审核”自动通过）时，报名详情页出现「报名码」卡片，用内置的 qrcode-generator 把 `CALMOBILE-CHECKIN|<展会>|<报名记录>` 画成二维码，并在下方给出同一段文本，便于手动输入；
2. 展商在展商后台点顶部「核销报名码」，进入 `pages/checkin.js`：请求摄像头权限后用 `getUserMedia` 取景，内置的 jsQR 按约 120ms 一帧解码画面中央区域，识别成功后调用 `checkin.scan`；
3. 原生侧校验报名码格式、展会与角色后把审核记录状态改为「已参加」，同步写入数据库并给报名人发送状态通知；重复扫描会提示“已经核销过了”，未通过的报名会说明当前状态。

页面离开时通过 `core/router.js` 的 `onPageStop` 关闭摄像头。摄像头不可用（未授权、无摄像头、内核不支持）时保留「手动输入报名码」入口。未启用报名二维码的展会不展示报名码，展商仍可在报名管理里手动把报名标记为「已参加」。

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
| `AppSettings` + `UserProfileStore` | 服务器设置（公告、分类、审核策略、媒体与上传限制、字符数上限）、应用配色与外观模式、个人资料（含地区、头像） |
| `ExhibitionConfiguration` | 展会扩展配置：开展/报名日期、封面、简介格式、报名收集项、报名二维码开关 |
| `CalendarHelper` / `NotificationHelper` / `ExportManager` | 系统日历、通知与 CSV 导出 |

数据库不可用时各 Manager 回退到内存示例数据；`ExhibitionCatalog` 保存首页示例展会的月份、展商与亮点信息。Room、Retrofit、Repository、ViewModel 与 `server/` 已有骨架，但尚未替换本地演示数据源。

逻辑对象包括：

| 对象 | 主要内容 |
| --- | --- |
| Exhibition | 名称、地点、日期、时间、状态、分类、HTML 简介、展商 |
| Registration | 展会、报名人、提交时间、审核状态（待审核 / 已通过 / 已拒绝 / 已参加 / 已撤销）、表单回答 |
| RegistrationField | 标题、类型（文本/单选/多选）、选项、必填 |
| User | 昵称、邮箱、简介、地区、头像、角色、账号状态、公开策略 |
| AppSettings | 配色、外观模式、启动公告、分类、审核后是否可修改、媒体与上传限制、字符数上限 |

## 技术选型与权限

Android 依赖集中在 `app/build.gradle`：AndroidX、Material、`richeditor-android`（旧页面使用）、Room、Retrofit/OkHttp、Gson、Glide、JUnit 和 Espresso。WebView 容器只使用平台 API，不额外引入 `androidx.webkit`，资源映射由 `WebShellActivity` 自行实现。

前端的第三方运行时依赖全部内置在 `assets/web/vendor/`，不依赖 CDN、图标字体或构建工具，版本与来源记录在各目录的 `VERSION.txt`：

| 目录 | 依赖 | 用途 |
| --- | --- | --- |
| `vendor/easymde/` | EasyMDE 2.21.0（MIT，内置 marked 与 CodeMirror 5） | Markdown 简介编辑器 |
| `vendor/qrcode-generator/` | qrcode-generator 1.4.4（MIT） | 把报名码画成二维码 |
| `vendor/jsqr/` | jsQR 1.4.0（Apache-2.0） | 在摄像头画面里识别报名码 |

应用声明 `POST_NOTIFICATIONS`、读写系统日历所需权限，以及核销报名码使用的 `CAMERA`（声明为可选硬件，无摄像头设备仍可手动输入报名码）。首次使用日历、通知或扫码时由前端发起申请，授权后继续执行原操作，拒绝时页面保留可用的浏览与报名流程。`WebShellActivity` 的 `onPermissionRequest` 只放行 `RESOURCE_VIDEO_CAPTURE`，且必须在应用层已获得摄像头权限时才同意。

### 原生界面与 WebView 的取舍

本版本已经把界面迁移到 WebView，原生 Activity 全部归档到 `legacy/` 并保留编译与清单注册，仅用于对照与回退。选择 WebView 的原因是：`newUI/` 交付件本身就是 HTML/CSS，直接复用可保证视觉一致；页面模块化后改动集中在 `assets/web`，无需重新编译 XML 布局。

代价与边界：离线资源由 APK 内置，媒体文件仍保存在设备本地；JavaScript 与 Android 返回栈通过 `history` 与 `WebView.canGoBack()` 同步；文件选择、日历写入、通知权限、CSV 导出和分享通过桥接调用系统界面；简介编辑器改为内置 EasyMDE，旧页面的 `RichEditor` 仍保留在 `legacy/`。

## 前后端边界（重构后端时看这一节）

前端不直接访问网络，**所有数据都经过 `js/core/bridge.js` 的 `call(action, payload)`**，由 `WebAppBridge` 分发到 `WebAppActions`。因此做前后端分离时，改造面收敛在 `WebAppActions` 一个文件里：把「读写本地 SQLite / SharedPreferences / 会话内存储」的分支换成对 `server/` 的 HTTP 调用，页面与 CSS 不需要改动。

### 47 个桥接动作的分类

`WebAppActions.handle()` 的分发 switch 共 47 个动作（另有 3 个 `case "display|closed|ended"` 属于 `modeLabel()` 内部的字符串分支，不是桥接动作）。

| 类别 | 动作 | 后端重构时的处理 |
| --- | --- | --- |
| **当前由本机数据提供（需换成 API）** | `bootstrap`、`auth.login`、`auth.register`、`auth.logout`、`auth.guest`、`profile.get`、`profile.save`、`profile.password`、`exhibitions.list`、`exhibitions.month`、`exhibitions.get`、`exhibitions.save`、`exhibitions.delete`、`exhibitions.status`、`exhibitions.categories`、`exhibitions.fields`、`exhibitions.saveFields`、`registrations.list`、`registrations.get`、`registrations.submit`、`registrations.cancel`、`review.list`、`review.get`、`review.updateStatus`、`checkin.scan`、`users.list`、`users.get`、`users.status`、`users.public`、`search.query`、`settings.get`、`settings.save` | 逐个对应到 `server/` 的路由；本机实现整体删除 |
| **服务器级配置（现在是 SharedPreferences 模拟）** | `settings.get` / `settings.save` | 现在按“保存后对所有用户生效”呈现，实际只写本机。重构后应改为服务端下发 |
| **系统能力（保留原生，不进 API）** | `calendar.status`、`calendar.toggle`、`notify.requestPermission`、`media.pickImage`、`media.pickVideo`、`media.import`、`media.store`、`media.imageData`、`share.text`、`export.csv`、`toast`、`camera.ensurePermission` | 依赖 Android 系统界面与硬件，继续留在 `WebAppActions` |
| **个人偏好（保留本机）** | `notify.preferences`、`notify.savePreferences`、`settings.uiMode` | 属于设备级偏好，不必上云；换新机不必同步，如需多端同步再随用户资料下发 |

### 现在只存在于客户端的业务数据（后端需要补的表/字段）

`server/src/config/migrate.js` 已有 `users` / `exhibitions` / `registrations` / `notifications` / `calendar_events` 五张表，但下列字段与数据目前**只在客户端**，重构时要补上：

| 数据 | 当前存放位置 | 缺什么 |
| --- | --- | --- |
| 展会扩展配置 | `ExhibitionConfiguration`（`static Map`，进程内） | 开展日期、报名起止、封面 URL、简介格式、报名二维码开关；`exhibitions` 表只有 `day/month/year` |
| 报名收集项 | `ExhibitionConfiguration.fields`（选项以英文逗号拼接） | 独立的收集项表（标题 / 类型 / 选项 / 必填） |
| 报名审核记录 | `RegistrationReviewStore`（`static List`，进程内） | 审核状态、报名码、核销时间；`registrations` 表没有这些列 |
| 通知与提醒偏好 | `NotificationHelper` + SharedPreferences | 用户维度的通知开关 |
| 个人资料扩展 | `UserProfileStore`（SharedPreferences） | 昵称、简介、地区、社交账号、头像 URL、`showRegistrations` 隐私开关 |
| 应用配色 / 外观模式 / 服务器设置 | `AppSettings`（SharedPreferences） | 需要服务端配置表 + 下发接口 |
| 上传的媒体 | 应用私有目录 `files/media` | 需要对象存储与上传接口（现在用 `appassets.androidplatform.net/media/<文件名>` 短 URL 引用） |

### `server/` 已有端点与桥接动作的对应

| 已有路由 | 对应桥接动作 |
| --- | --- |
| `POST /api/auth/login\|register\|refresh\|logout` | `auth.login`、`auth.register`、`auth.logout` |
| `GET /api/exhibitions`、`GET /api/exhibitions/search`、`GET /api/exhibitions/:id` | `exhibitions.list`、`search.query`、`exhibitions.get`、`exhibitions.month`（月份筛选已支持 query 参数） |
| `POST\|PUT\|DELETE /api/exhibitions`、`PUT /api/exhibitions/:id/status` | `exhibitions.save`、`exhibitions.delete`、`exhibitions.status` |
| `GET\|POST\|PUT\|DELETE /api/registrations` | `registrations.list`、`registrations.get`、`registrations.submit`、`registrations.cancel` |
| `GET\|PUT\|DELETE /api/users`、`PUT /api/users/:id/status` | `users.list`、`users.get`、`users.status`、`users.public` |

**尚无对应端点的动作**（重构时需要新增）：`review.list`、`review.get`、`review.updateStatus`、`checkin.scan`（核销）、`exhibitions.categories`、`exhibitions.fields`、`exhibitions.saveFields`、`settings.get`、`settings.save`、`bootstrap`（一次拉取用户态 + 全部配置的聚合接口）。

## 待优化的结构（前后端分离前可先做的部分）

以下是纯客户端、与后端无关的清理项，按收益排序。带 ★ 的会直接影响后续接 API 的成本。

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| 1 ★ | `WebAppActions.java` 2,100 行 | 桥接分发、业务规则、文件 IO、权限申请混在一个类；接 API 时所有改动都挤在这里 | 按动作域拆成 `AuthActions` / `ExhibitionActions` / `RegistrationActions` / `ReviewActions` / `MediaActions` / `SettingsActions`，`handle()` 只做路由表分发 |
| 2 ★ | `ExhibitionConfiguration`（`static Map`） | 用进程内静态表当存储，重启即丢；`save()` 是位置参数，调用方必须先把现值读回来再原样传进去 | 改为有序的 setter 集合或 builder；后端化时这层整体被 API 取代 |
| 3 ★ | `RegistrationReviewStore` | 「示例数据播种」与「真实记录」混在一个列表，主键 `registration-N` 会与 SQLite 报名记录撞号（ADB 回归时看到管理员报名出现在普通用户列表里，根因在此） | 把 demo 播种拆到独立 `DemoData`，或播种时用不冲突的前缀 |
| 4 | 5 处复制页脚 | `detail.js:16`、`registration-detail.js:17`、`exhibition-form.js:34`、`rich-editor.js:19`、`user-public.js:19` 各写一遍内联页脚容器样式 | 提为组件（如 `components.js` 的 `pageFoot()`）或 `.page-foot` 类 |
| 5 | 3 处复制按钮工厂 | `admin.js:532 smallButton`、`profile.js:259 smallButton`、`exhibitor.js:106 actionButton` 三份几乎相同 | 合并到 `components.js`，用 `size`/`variant` 参数区分 |
| 6 | 43 处 `catch (error) { toast(...) }` | 同样的错误提示模板重复 43 次 | 收成 `guard(promise, fallbackMessage)` 辅助函数 |
| 7 | 状态字符串散落 | `'待审核' / '已通过' / '已拒绝' / '已参加' / '已撤销' / '需审核' / '无需审核' / '仅展示'` 在 7 个前端文件里共出现 40 次，且与原生常量各写一份 | 抽 `js/core/status.js` 集中声明并导出 `statusTone()`，与原生 `RegistrationReviewStore` / `ExhibitorExhibition` 的常量一一对应 |
| 8 | 原生侧双份表单上限 | `AppSettings.saveTextLimits` 用两个 `int[]`（12 个位置魔数），而 `textLimits()` 用命名 key，同一份数据两套真相；中文标签在 `admin.js` 又抄一遍 | 改为 `Map<String,Integer>` 或直接把 limits 存成 JSON，前后端共用同一份键名 |
| 9 | 19 个从未被调用的前端导出 | `app.js:syncUser`、`bridge.js:isReady`、`dom.js:delegate\|formatDate\|orDash\|today`、`markdown.js:looksLikeMarkdown`、`router.js:currentRoute`、`sanitize.js:isBlankHtml`、`validate.js:formatsText\|isEmpty\|isEmail\|dateOrderRule\|extensionAllowed`、`components.js:syncSegments\|rowCard\|textField\|textAreaField\|selectField` | 直接删除；`rowCard`/`textField` 等若打算在重构里用，就补上使用点或标注为公共组件 |
| 10 | `--accent-soft` | `bridge.js:258` 每帧写入，CSS 里零消费 | 删除该变量的计算 |
| 11 | `media.imageData` 动作 | 唯一调用点 `detail.js:131` 只在 `imageUri` 非 `http(s):/data:` 时触发，而落地后的 `imageUri` 一定是 `https://appassets.../media/...`，是死分支 | 删掉该分支与对应原生动作（可与媒体上云一起做） |
| 12 | 过期的向后兼容 shim | `UserProfileStore.java:67` 的 `contact` → `region` 键回退（旧 `ProfileActivity` 写的键）；`AppSettings.java:130` 的分类换行分隔兼容；`ExhibitionCatalog.java:9`、`ExhibitorExhibition.java:5` 引用了已归档的 `MainActivity` | 随 `legacy/` 一起删除 |
| 13 | `legacy/` 整包 + 16 个布局 + `res/values` 四件套 | 5,448 行 Java + 1,199 行布局 + `strings/colors/dimens/styles`（303 次 `R.string`、308 次 `R.color/dimen` 引用全部来自 legacy），已零引用：唯一渲染入口是 `WebShellActivity.setContentView(container)`；仅 `MainTabStateTest`（24 行）依赖 | 删包、删布局、删 `MainTabStateTest`，`res/values` 只留 `AppTheme` 与 `app_name`；同步改 `smoke-check.js` 的 4 处断言与本文档「原生界面与 WebView 的取舍」 |
| 14 | `database/` + `models/` + `network/` + `repository/` + `viewmodel/` | 2,043 行，只在内部互相引用（`AppDatabase` 从未实例化，`viewmodel/` 无人调用）；`models/Exhibition`、`models/Registration` 与根包 `ExhibitorExhibition`、`Registration` 是同名不同类的两份模型 | **前后端分离后这层会被真正的 API 客户端取代**，可按新 API 的形状重写而不是维持；重写前建议连同 `app/build.gradle` 里的 Room/Retrofit 依赖一起清掉，避免两套数据模型并存 |
| 15 | `showRegistrations` 隐私开关 | 用户**无法打开**：资料编辑表单里没有这个控件，`profile.js` 两处保存都传 `state.user.showRegistrations === true`（恒为 false），于是 `user-public.js` 的「公开」分支与「还没有可展示的报名记录」文案都是死路径 | 补一个开关控件，或把该字段从表单链路里去掉 |

## 构建、测试与运行

环境要求：Android Studio、JDK 17、Android SDK 34、Gradle Wrapper 8.5；Windows 命令如下，Linux/macOS 将 `gradlew.bat` 换为 `./gradlew`。

```bash
# 结构检查（清单、桥接契约、页面文件、设计令牌、动效层、内置依赖、文档）
node scripts/smoke-check.js

# 前端静态检查（ES 模块解析、动作名与页面文件一致性）
node scripts/webui-check.js

# 检查脚本自身的单元测试（启动入口解析等）
node --test scripts/smoke-check.test.js

# 前端页面渲染冒烟测试（最小 DOM 打桩 + 假桥接，逐页渲染并校验关键交互）
node --test scripts/webui-render.test.js

# Android 单元测试与调试 APK
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug

# 运行指定测试
gradlew.bat :app:testDebugUnitTest --tests 'com.example.calmobile.CalendarHelperTest'
```

后端开发请进入 `server/`，按 `server/README.md` 创建 PostgreSQL 数据库并复制 `.env.example`；常用命令为 `npm install`、`npm run db:migrate`、`npm run db:seed`、`npm run dev`、`npm test -- --runInBand` 和 `npm run lint`。

客户端测试位于 `app/src/test/java/com/example/calmobile/`，覆盖认证、数据库、展会、报名、用户管理、导出、通知、日历、富文本和搜索等 Manager/Helper 流程；Activity 级 UI 测试仍在路线图中。前端另有 `scripts/webui-render.test.js`：它用最小 DOM 打桩加假桥接，把 18 个页面路由各渲染一次，并校验管理后台分区记忆、深色模式切换、报名码展示、展商卡片入口、扫码核销与用户公开页管理视角等关键交互，用来补足纯静态检查发现不了的接线错误。

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
4. 展商或管理员打开报名管理，用滑块切换筛选，在底部面板查看回答并通过或拒绝；展商能否再次修改已审核记录由「允许重新审核」开关决定，管理员在任何情况下都可以切换报名人状态；无需审核的展会提交后即为已通过。
5. 管理员在个人页的「设置」中切换配色并保存，主按钮、次按钮边框与文字、开关、分段控件与底部导航同步换色，次按钮的浅色底始终与页面背景一致；在管理后台的「设置」分区维护软件中英文标题、公告、分类、审核策略、媒体与上传限制、字符数上限，保存后首页品牌行与所有用户的表单校验、上传校验同步更新。
6. 普通用户在个人页上传头像，在圆形裁剪面板里单指拖动、双指捏合缩放后确认，头像立即更新并在用户公开页展示；「地区」字段在编辑资料表单与公开页保持一致。
7. 任何用户在个人页「深色模式」里选择「深色」，整个应用（含状态栏与页面底色）立即切换，关闭应用重新打开仍是深色；选择「跟随系统」时随系统深浅色变化。
8. 管理员在管理后台切到「展会」分区，点某个展会的「查看报名」进入报名管理再返回，仍停在「展会」分区；点「公开页」进入用户公开页，即使该用户关闭了「展示我的报名」，也能看到完整的已参加展会记录。
9. 展商在「编辑展会 → 报名与简介设置」开启「启用报名二维码」并保存；用户报名且审核通过后，报名详情出现报名码；展商在展商后台点「核销报名码」扫码，页面提示核销成功、状态变为「已参加」；再次扫描同一张码会提示已经核销过。

## 路线图与已知限制

- 后端 API 未接入：展会、报名、审核与资料仍以本地 SQLite、会话内存储和 SharedPreferences 为准，重启应用后审核记录与登录态不会保留。
- 「服务器设置」目前保存在本机 SharedPreferences，界面按“保存后对所有用户生效”的语义呈现；接入服务端后应改为下发配置。
- 视频上传待服务端接口：Markdown 编辑器可调用系统选择器，但不做真实上传与转码。
- 媒体文件保存到应用私有目录 `files/media` 并通过短 URL 引用，仍属于设备本地存储；卸载应用会一并清除。
- 旧 `legacy/` 页面与新前端共用 `RegistrationReviewStore`，删除旧页面时需同步检查该引用。
- 认证仍是明文比对的内置账号，缺少密码哈希与安全持久化。
- 报名码的二维码开关与核销状态保存在会话内（`ExhibitionConfiguration` 与 `RegistrationReviewStore`），重启应用后需要重新开启；接入服务端后应随展会与报名记录落库。
- 继续补齐前端页面的无障碍检查，并把剩余硬编码文案迁移到 `strings.xml`。

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
| 报名二维码的启用开关 | 保存在 `ExhibitionConfiguration` 会话内，默认关闭；核销状态写入 `RegistrationReviewStore` | 是否需要随展会落库并支持按展会查询核销记录 |
| 核销权限 | 展商与管理员都可以核销；展会记录没有“归属展商”字段，因此只校验角色与展会是否存在 | 是否需要给展会补充归属展商字段并收紧为“只能核销自己的展会” |

## 变更记录

- 2026-09-14：首页日历去掉选中日期的方框底色，改为「强调色加粗数字 + 数字下方一小段下划线」，保留键盘焦点环；次按钮的浅色底统一取页面底色，应用配色只改边框与文字；新增深色模式（跟随系统 / 浅色 / 深色，含原生状态栏与底色）；开关等按钮去掉点击时的系统蓝色高亮方框；首页日历「有展会」圆点改为与上方数字同轴居中；头像裁剪由滑块改为双指捏合缩放；展商卡片只保留查看报名与编辑展会，报名方式 / 编辑简介 / 删除展会移入编辑展会二级界面；修复管理后台从展会二级页面返回后跳回用户分区；管理员查看报名始终可切换报名人状态、查看用户公开页不受隐私设置影响；新增报名二维码与展商扫码核销。
- 2026-09-14：应用配色扩展到主按钮填充、次按钮边框/填充/文字与开关打开态；新增软件中英文标题设置并显示在首页及其它品牌位；顶部导航栏统一高度并去掉标题下的强调短线；修复日历滑动切月后卡片被压缩导致下边框显示不全。
- 2026-09-14：无需审核的展会提交即通过；长简介图片改为落盘短 URL 并自动改写历史内联图片；服务器设置迁回「管理-设置」并新增上传格式与字符数上限；修复应用配色不生效并扩大强调色覆盖面；个人页去掉用户公开页入口、联系方式改为地区、新增头像上传与圆形裁剪；分段控件与底部导航改为滑动指示动效；展会图片统一为 1080×1920 竖向比例并支持上传封面；首页日历支持左右滑动切换月份并适配六行月份；所有表单补齐前端数据格式校验。
- 2026-09-14：加入动效层（页面切换、抽屉、按压、悬浮、状态切换），首页去掉重复入口，个人页合并设置栏，管理后台内联展会管理与系统设置，简介编辑器改用内置 EasyMDE（Markdown），收集项支持逐条增删选项，并排字段改为等高对齐。
- 2026-09-14：前端迁移到 WebView，按 `newUI/` 的页面拆分模块，新增 `WebAppBridge`/`WebAppActions` 桥接层，旧 Activity 归档到 `legacy/`。
- 2026-09-14：按 newUI 灰盒规范重构颜色、卡片、表单、首页月历、详情分享、搜索跳转和我的报名列表。
- 2026-09-14：合并重复 Markdown，更新 API 34、富文本编辑、日期时间选择、四项导航、管理员设置和当前限制。
- 2026-09-14：完成展会简介二级富文本编辑器、图片插入以及报名起止日期并排选择。
