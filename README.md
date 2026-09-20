# CalMobile

CalMobile 是面向展会排期、详情展示、报名和审核的应用。前端由 WebView 承载 `newUI/` 的 17 屏设计，业务数据全部来自 `server/` 的 Express + PostgreSQL 后端，Android 侧只保留「只有设备能做」的系统能力（日历、通知与摄像头权限、媒体选择与落盘、分享、导出、系统栏配色）。

## 文档入口

- `README.md`：唯一的产品说明、需求、架构、界面规范、验收场景和路线图。
- `AGENTS.md`：贡献者与自动化代理的工作约定。
- `server/README.md`：Node.js 服务的数据库配置、启动方式和 API 目录。
- `newUI/`：设计交付件（`index.html`、`remaining-ui.html`、`ui-spec.md`、`DESIGN-HANDOFF.md`、`DESIGN-MANIFEST.json`），是界面标准的来源。

本文件是唯一的需求、架构、界面规范、验收场景与路线图来源；`README.md` 只描述**当前状态**（含当前限制与上线清单），不记录改动历史 —— 历史看 git log。

## 产品范围与角色

应用支持访客浏览，登录后根据账号角色显示功能：

- 普通用户：浏览月历、查看展会详情、填写报名、取消报名、维护个人资料和查看公开主页。
- 展商：创建、编辑、删除自己的展会，维护分类、日期、时间、简介和报名收集项，查看报名并执行通过/拒绝审核。
- 管理员：管理用户和全部展会，暂停/恢复报名、导出 CSV，并设置应用配色、启动公告、展会分类、重新审核开关以及富文本媒体限制。
- 账号状态（在角色之上再收一层）：**正常** / **受限** / **封禁**。受限账号仍能登录、浏览、查询、审核报名、改密码、管理通知偏好与撤销自己的报名，但**不能报名、不能发布或修改展会（编辑 / 删除 / 暂停恢复 / 报名设置）、不能核销、不能编辑个人信息**（`user.can` 里 `register` / `profile` 为 false，`limited` 为 true，页面据此把入口置灰并说明原因）；封禁账号在认证层直接被拒。管理员不受限制（否则没人能解除）。

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
│       │                       api.js（唯一取数入口）、loadable.js（先画缓存）、preload.js（预加载）
│       ├── ui/components.js    顶部栏、卡片、分段控件、头像与裁剪、状态块、弹层、轻提示
│       └── pages/*.js          15 个页面模块，一屏一文件
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

桥接协议：前端调用 `CalMobileNative.invoke(action, payloadJson, callbackId)`，原生处理完成后回调 `window.CalMobileBridge.onResult(callbackId, ok, result, error)`。前端只使用 `js/core/bridge.js` 的 `call(action, payload)`，异常统一抛出 `Error` 由页面就地展示；`call()` 对不弹系统界面的同步动作（日历、`ui.sync`、`media.store`、`share.text`）带 30 秒兜底超时，原生忘记回调时 promise 会拒绝而不是永久挂起。

页面与设计稿编号的对应关系：

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

### 界面标准

- 沿用 newUI 令牌：背景 `#F7F6F3`、页面白色、主文字 `#20252B`、次文字 `#626A74`、弱化文字 `#969DA7`、描边 `#C5CAD1`、主按钮 `#48515D`、强调色 `#C05621`（可由管理员配色覆盖）。
- 线框以 216×480 的手机框绘制，生产版按 390dp 逻辑宽度等比例换算（约 ×1.8）：正文 16px、标题 26px、控件高 48px、圆角 8/12/16/20px。
- 触控区域不小于 44px；状态始终同时使用文字与颜色；空、加载、错误、成功状态在原位置给出下一步说明。
- 日期、时间、状态和报名方式使用选择器、分段控件或内嵌面板，不使用下划线输入框。
- Markdown 与富文本渲染前统一经过 `js/core/sanitize.js` 白名单清洗。
- 焦点环只在键盘导航（`:focus-visible`）时出现：点击开关、分段控件、日历日期这类按钮不会在周围闪出系统高亮方框；日历的选中日期不用方框，而是「强调色加粗数字 + 数字下方一小段下划线」。
- 二维码固定白底黑点，不跟随深色模式反色，否则部分扫码器无法识别。

### 深色模式

个人页「设置」栏提供「跟随系统 / 浅色 / 深色」三选一（`settings.uiMode`，权威值存在后端 `users.ui_mode`，本机只留镜像），`js/core/bridge.js` 的 `applyMode` 把结果写进 `<html data-mode>`，`styles/tokens.css` 用同一组令牌的深色取值接管全部颜色，因此页面与组件无需逐页适配。`index.html` 的内联脚本会在样式表生效前先落到 localStorage 里缓存的模式，避免首帧闪白；选择「跟随系统」时由 `prefers-color-scheme` 与 `matchMedia` 的 `change` 事件驱动。强调色的衍生值（`--accent-ink`、`--accent-tint`、`--accent-edge`）在深色下改为与深色页面底混色，保证对比度。原生侧同步把状态栏、导航栏与 WebView 底色切到深色取值（`AppSettings.isDarkMode` / `getScreenColor`）。

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

### 账号、邮箱验证与两步验证

注册是两步的：先填用户名 / 邮箱 / 密码，后端校验通过后把验证码发到邮箱，**输对码才真的建账号** —— 库里因此不存在「注册了但邮箱没验证」的半成品账号，待建账号（密码已哈希）暂存在验证码记录里，10 分钟不验证就随过期码一起消失。同页第二屏可以重发（60 秒倒计时，秒数取后端下发的值），「返回修改」保留已填内容。

登录接受**用户名或已验证邮箱**。账号开启两步验证后，第一步（密码正确）只发一张 5 分钟有效、单次使用的预认证票，并把验证码发到邮箱，**此时不给任何令牌**；第二步用票 + 码换真正的会话。预认证票只存哈希、可撤销，所以「密码泄露」不等于「账号到手」。收不到码可以用同一张票重发。

第二因子有三种，**并列可用**，登录时填哪一种都行：**验证器（TOTP）**是日常方式 —— 开启时给出二维码与可手抄的密钥，输对一次验证码才算绑定成功（扫了个没成功的码就打开关会把人锁在门外）；**邮箱验证码**是退路（换手机、验证器丢了但邮箱还在）；**备用码**是最后一道（手机和邮箱都用不了时，用开启时抄下的 10 个一次性码，每个只能用一次）。绑定验证器后**登录不再自动发邮件码**（省一封多半用不上的信，也避开同一邮箱 60 秒一条的冷却），需要时点「发送邮箱验证码」主动要一条。开启两步验证时会一次性给出备用码（库里只存 sha256，关掉就再也看不到），要重置得输当前密码、旧码随即全部作废。

邮箱是账号的凭据，因此只在「个人页 → 安全」里改

邮箱是账号的凭据，因此只在「个人页 → 安全」里改，而且要先验证新地址（验证码发到新邮箱、通过才落库），资料编辑表单不再提供邮箱字段。两步验证的开关也在同一处：开启前要先过码（证明邮箱现在真的能收信），关闭要输当前密码；用户的邮箱一旦用不了，管理员可以在「管理 → 用户」里替他关闭两步验证，那是唯一的兜底出口。

忘记密码在登录页有独立入口：填注册邮箱收验证码 → 输码设新密码。这个接口**不区分邮箱是否注册过**（响应与耗时一致），所以界面写的是「如果该邮箱已注册，验证码会发送到该邮箱」；重置成功后会撤销该用户全部刷新令牌，其它设备需要重新登录。

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

展会在「编辑展会 → 报名与简介设置」里通过「启用报名二维码」开关控制是否发放报名码（后端 `exhibitions.qr_enabled`）。启用后：

1. 用户的报名审核通过（或“无需审核”自动通过）时，报名详情页出现「报名码」卡片，用内置的 qrcode-generator 把 `CALMOBILE-CHECKIN|<展会>|<报名记录>` 画成二维码，并在下方给出同一段文本，便于手动输入；
2. 展商在展商后台点顶部「核销报名码」，进入 `pages/checkin.js`：请求摄像头权限后用 `getUserMedia` 取景，内置的 jsQR 按约 120ms 一帧解码画面中央区域，识别成功后调用 `checkin.scan`；
3. 后端校验报名码格式、展会与角色后把报名记录状态改为「已参加」，写回 `registrations` 并给报名人落一条通知；重复扫描会提示“已经核销过了”，未通过的报名会说明当前状态。

页面离开时通过 `core/router.js` 的 `onPageStop` 关闭摄像头。摄像头不可用（未授权、无摄像头、内核不支持）时保留「手动输入报名码」入口。未启用报名二维码的展会不展示报名码，展商仍可在报名管理里手动把报名标记为「已参加」。

### 表单校验

`js/core/validate.js` 统一实现必填、长度、格式与跨字段校验，长度上限来自服务器设置（`state.limits`），并在字段下方给出字数计数与内联错误。覆盖登录、注册、修改密码、编辑资料、展会编辑、报名填写等表单；后端保存前会再校验一次，避免绕过页面直接调接口。

## 架构与数据边界

业务规则只存在一处——`server/src/domain/`。前端不复制规则，原生不复刻数据：

| 组件 | 职责 |
| --- | --- |
| `server/src/routes/*.js` | REST 路由：`bootstrap`、`auth`、`profile`、`exhibitions`、`registrations`、`review`、`checkin`、`users`、`search`、`settings`、`status` |
| `server/src/domain/` | 业务层：状态词汇表（`labels.js`）、SQL 片段（`queries.js`）、响应映射（`payloads.js`）、权限（`permissions.js`）、校验（`validation.js`）、设置（`settings.js`）、会话与令牌（`session.js`）、错误与信封（`errors.js` / `respond.js`） |
| `server/src/config/migrate.js` | 表结构与示例数据，按编号记录迁移、可反复执行 |
| `js/core/api.js` | 前端唯一取数入口：动作名 → REST 路径的映射表 + 401 自动续期 |
| `js/core/bridge.js` | 只负责启动、文案注入、外观应用与 `ui.sync` 设备镜像 |
| `WebAppActions` + `SystemActions` / `MediaActions` | 10 个系统动作的原生实现：日历、通知与摄像头权限、媒体选择与落盘、分享、CSV 导出、设备镜像 |
| `CalendarHelper` / `NotificationHelper` / `ExportManager` | 系统日历读写、通知渠道与权限、CSV 生成 |
| `AppSettings` | 设备侧镜像（外观模式、配色下标、媒体上限、系统栏颜色），权威值在后端 |

数据只有一处来源：后端 PostgreSQL（表结构见 `server/src/config/migrate.js`）。原生不再持有任何业务数据实现，后端连不上时应用直接报错并给出排查提示，不做本地降级。

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

界面只有 WebView 一处入口：`WebShellActivity` 是清单里唯一的 Activity，界面代码全部在 `assets/web`。选择 WebView 的原因是 `newUI/` 交付件本身就是 HTML/CSS，直接复用可保证视觉一致；页面模块化后改动集中在 `assets/web`，无需重新编译 XML 布局。

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

`api.js` 内部是一张**动作名 → REST 请求**的映射表（`ENDPOINTS`）：按表把动作翻成 `GET/POST/PUT/DELETE /api/v1/...`，带 `Authorization: Bearer`；访问令牌过期（401）时自动用刷新令牌换一次再重试。**没有第二条路径**，原生不再有数据实现，5xx 与连不上都会如实抛出 `TransportError`，由页面把原因（后端地址、`npm run dev`、`adb reverse` 提示）显示出来。`scripts/webui-check.js` 会拦住绕过 `api.js` 直接调数据类动作的写法。

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

### 后端与连通性

后端是 `server/` 里的 Express + PostgreSQL 服务，接口按 REST 组织，路径与前端 `api.js` 的动作一一对应（映射表在 `js/core/api.js` 的 `ENDPOINTS`）。

```bash
# 1. 起数据库（Docker 容器 calmobile-pg）
pwsh -File scripts\db.ps1 start

# 2. 建表 + 示例数据（可反复执行）
cd server && npm install
cp .env.example .env                # 按需改数据库连接与 JWT 密钥
npm run db:migrate && npm run db:seed
npm run dev                         # 开发模式（nodemon），http://127.0.0.1:3000

# 3. 真机 / 模拟器访问本机后端
adb reverse tcp:3000 tcp:3000
```

**`npm run dev` 与 `npm start` 是两种模式**：`dev` 走开发模式（状态页开着、不做启动自检）；`start` 自动进**生产模式**（`node src/index.js --production`）——关掉 `/status` 与 `/api/v1/status`、对配置做启动前自检（开发密钥、默认库密码、验证码只写日志这类致命项直接拒绝启动），对生产库迁移用 `npm run db:migrate:prod`。判定集中在 `server/src/config/runtime.js`，细节见 `server/README.md`。

示例账号 `demo` / `exhibitor` / `user`，密码都是 `password`（角色分别是管理员、展商、普通用户）。

后端**启动时不要求数据库可用**：连不上库时会在日志里给出警告并照常监听端口，`/status` 健康页会把这些检查项标红，方便先排查连接再处理业务。数据库跑在 Docker 里（容器 `calmobile-pg` + 命名卷 `calmobile-pgdata`），`server/.env` 不用改；容器**必须带时区参数**（脚本已带 `Asia/Shanghai`）：镜像默认 UTC，而数据库的 `CURRENT_DATE` 决定报名窗口与日历落点，不设的话本机凌晨那段时间会莫名差一天。

**改了 `server/src/*.js` 要重启进程**：Node 会缓存已加载的模块，旧进程会继续按改之前的逻辑应答。

细节见 `server/README.md`；`server/test/api.test.js` 是前后端契约与接口测试，逐接口断言页面真正用到的字段都在、权限与业务规则都拦得住，字段漂移会在这里失败而不是静默渲染成空。

### 原生只剩 10 个系统动作

`WebAppActions.handle()` 的 switch 就是权威清单，数据动作一律不在其中（`scripts/smoke-check.js` 的 `native-actions-whitelist` 与 `scripts/webui-check.js` 双重看守）：

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

业务数据只有一处来源：后端 PostgreSQL，表结构在 `server/src/config/migrate.js`（迁移按编号记录，可反复执行）——`users` / `exhibitions` / `exhibition_fields` / `registrations` / `app_settings` / `notification_preferences` / `refresh_tokens` / `notifications` / `schema_migrations`。展会扩展字段、收集项、审核状态与核销时间都有正式的列。

**仍然只在客户端**的只有两类：

| 数据 | 存放位置 | 说明 |
| --- | --- | --- |
| 上传的媒体 | 应用私有目录 `files/media` | 需要对象存储与上传接口；现在用 `appassets.androidplatform.net/media/<文件名>` 短 URL 引用 |
| 设备事实 | `AppSettings`（SharedPreferences） | 外观模式与配色的本地镜像、日历与通知权限；权威值在后端（`users.ui_mode`、`app_settings`） |

### `server/` 端点与前端动作的对应

健康与状态页：`GET /ping`、`GET /health`，以及给人看的 `GET /status` 与机器读的 `GET /api/v1/status`（这两个**在生产模式下默认关闭**，见「上线部署清单与开销」）；其余都在 `/api/v1` 下。完整清单（含请求参数、权限与响应形状）见 `server/README.md` 的「接口清单」，这里只列骨架：

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

前端动作名与这些路径的映射写在 `js/core/api.js` 的 `ENDPOINTS` 表里，新增接口要同时改那张表、后端路由与 `server/test/api.test.js`（那里有前后端路由交叉校验，多一条少一条都会失败）。

### 月视图与日历落点（已固定的两处契约）

| 约定 | 说明 |
| --- | --- |
| `exhibitions.month` 的参数只有 `year` / `month`（`day` 可选，用于深链定位初始选中日期） | 参数形状固定，前端与预加载才发得出同一个缓存键 |
| 请求哪个月就返回哪个月 | 空月份返回 `eventDays: []`、`day: 0`，不会悄悄换成有展会的月份 |
| 首次打开看哪个月由 `bootstrap` 的 `calendar.landing = { year, month }` 决定 | 落点规则属于「界面先给用户看什么」，不属于月视图接口；`exhibitions.month` 因此不需要 `explicit` 参数 |
| 选中日期由前端本地决定 | 月视图一次返回整月数据，点日期不往返请求 |

后端的示例展会日期是**相对今天**生成的（`db:seed` 用 `CURRENT_DATE + N days`），因此日历落点、报名窗口这些与「今天」有关的规则永远有可演示的数据。

## 构建、测试与运行

环境要求：Android Studio、JDK 17、Android SDK 34、Gradle Wrapper 8.5；Windows 命令如下，Linux/macOS 将 `gradlew.bat` 换为 `./gradlew`。

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

后端开发请进入 `server/`，按 `server/README.md` 起好 PostgreSQL 并复制 `.env.example`；常用命令为 `npm install`、`npm run db:migrate`、`npm run db:seed`、`npm run dev`、`npm test`（jest 单测）、`npm run test:contract`（接口契约）和 `npm run lint`。

客户端测试位于 `app/src/test/java/com/example/calmobile/`（39 项），覆盖系统日历的日期与时间解析、媒体上限区间与后缀列表解析、设备镜像、CSV 导出、桥接取值助手和资源路径守卫（`CalendarHelperTest`、`AppSettingsTest`、`ExportManagerTest`、`WebAppBridgeTest`、`AssetGuardTest`）；Activity 级 UI 测试仍在路线图中。原生与前端的日历契约按**后端下发的 ISO 日期**（`YYYY-MM-DD`）传参，不要在原生侧猜年月——写死月份的缺陷曾让事件落到错误的月份，而测试把常量抄成期望值后照旧全绿。

后端测试分两层：`server/test/api.test.js`（59 项）跑真实 Express + PostgreSQL，逐接口断言页面用到的字段、四类身份的权限边界、报名窗口 / 重复报名 / 自动通过 / 审核状态机与核销流转 / 报名收集项校验 / 登录限流 429 / 隐私开关（公开页不下发报名码）这些业务规则、**邮箱验证码体系**（两步注册、找回密码不泄露存在性、两步验证的票据与令牌边界、改邮箱要验证新地址）、数据库不可用时的状态页降级，以及**前后端路由交叉校验**（前端每个数据动作都有对应路由、后端没有前端用不到的路由）；`server/src/**/*.test.js`（jest，95 项）是不依赖数据库的纯函数与单测。库结构变更后跑 `npm run db:migrate` 即可，迁移是幂等的。

前端另有 `scripts/webui-render.test.js`（35 项）：它用最小 DOM 打桩加假后端 `fetch`，把 20 条路由用例（同一页面的不同参数各渲染一次）都真渲染一遍，并校验管理后台分区记忆、深色模式切换、报名码展示、展商卡片入口、扫码核销、用户公开页管理视角、注册与找回密码的两步流程、「数据动作不再经过原生桥接」「点日期与切月份不再取数」「缓存命中时同步出内容」「过期缓存仍可先画一屏」「并发请求去重」「标签页预加载」等取数体验，以及 `api.js` 的动作到 REST 路径映射与 401 自动续期。渲染测试通过 `router.whenStarted()` 等待首次渲染完成，用例涉及预加载时先 `await settle()` 排空空闲队列再开始计数，不依赖固定的 sleep 猜测时序。

可用模拟器时，可安装并逐屏回归：

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.example.calmobile/.WebShellActivity

# 仓库内提供的回归辅助脚本（截图、按可见文字点击、查看日志）
pwsh -File scripts\emu.ps1 install
pwsh -File scripts\emu.ps1 shot .omo\evidence\02-home
pwsh -File scripts\emu.ps1 tap-text "以访客身份浏览"
pwsh -File scripts\emu.ps1 logs

# 动效回归前先确认设备的动画开关（详见下面「动效看起来全没了」）
pwsh -File scripts\emu.ps1 motion
```

`emu.ps1` 的 `tap-text` 依赖系统的无障碍节点树，WebView 里的文字不会出现在 UI dump 中，因此界面回归要用 `tap <x>,<y>` 按坐标点击：截图是 1080×2400，而在对话里预览时会被缩到一半，换算坐标时注意 ×2。

**动效看起来「全没了」时先查设备开关，不要先改代码。** WebView 把系统的 `animator_duration_scale = 0` 映射成 `prefers-reduced-motion: reduce`，而 `tokens.css` 会据此把所有动画压成 `0.01ms`——现象就是页面切换、列表淡入、日历滑动一律静止。模拟器上这个开关常被前一次压测/截图任务关掉：

```powershell
pwsh -File scripts\emu.ps1 motion check   # 三个 scale 都应为 1
pwsh -File scripts\emu.ps1 motion         # 置 1；之后重新进入页面生效
```

报名二维码可以用设备截图做端到端校验：先在报名详情里截屏，再用内置解码库识别屏幕上的真实像素。

```powershell
adb shell screencap -p /sdcard/qr.png
adb pull /sdcard/qr.png .omo\evidence\qr.png
# 整张截图自动搜索，或指定区域 x,y,w,h
node scripts/decode-shot.js .omo\evidence\qr.png
node scripts/decode-shot.js .omo\evidence\qr.png "254,1145,572,572"
```

`decode-shot.js` 自带一个不依赖第三方包的 PNG 解码器（Node 内置 zlib 即可），把截图还原成 RGBA 后交给 `assets/web/vendor/jsqr` 里的同一个解码库，因此“识别成功”等价于展商扫码时也会成功。

### 启动耗时打点

首帧慢是 WebView 应用的常见问题，因此 `core/bridge.js` 内置了打点：`mark()` 在关键节点记录 `performance.now()`，`reportTimings()` 把结果写进 `window.__CALMOBILE_TIMING__` 并打印一次，原生 `onConsoleMessage` 会转进 logcat。

```powershell
adb logcat -s WebShellActivity | Select-String "web timing"
# web timing: main-start=2ms native-ready=432ms boot-start=134ms ready=140ms
#             page:login=210ms api-loaded=241ms bootstrap-done=1295ms entered=1296ms
```

本机模拟器上的实测基线：`bootstrap-done ≈ 1.3s`、登录页首帧 `≈ 210ms`（直接发请求，不做「先探测再请求」的预探测——预探测每次超时 1.5s、还要连试三轮）。后端不可用时首屏直接给出连接失败的原因。

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

`docs/screenshots/` 只保留课程报告脚本 `scripts/generate_report.py` 引用的 8 张界面截图。

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
10. 展商在 Markdown 编辑器里点「插入视频」，选一个不超过「管理-设置」里视频大小上限的文件，保存后详情页可以播放；正文里已有视频数量达到上限时再插入会被提示拦住；选超限文件时提示超过上限且不会写进设备。
11. 管理员在管理后台把某个展商的状态改为「受限」，该展商登录后：「立即报名」「新建展会」「编辑展会」「核销报名码」「编辑资料」入口全部置灰并说明原因，直接打开报名表单或展会编辑页的深链也只看到限制说明；浏览、搜索、查看与审核已有报名、改密码、通知偏好、撤销自己已有的报名仍然可用；管理员自己做同样这些事不受影响；改回「正常」后入口恢复。
12. 新用户在注册页填完资料后看到「验证码已发送到：邮箱」并进入输码步骤，60 秒后可以重发；输对码才建号并直接进入首页，而在此之前用同样的账号密码登录会失败。mailpit（本地收件箱）里能查到这封双语邮件。
13. 用户在登录页点「忘记密码」，填注册邮箱收到验证码、设新密码后回到登录页；用旧密码登录失败、新密码成功，其它设备上原有的登录状态一并失效（刷新令牌被撤销）。填一个没注册过的邮箱也能走到输码那一步（后端不透露邮箱是否存在）。
14. 用户在个人页「安全」里开启两步验证，可以先选「用验证器开启」——扫码或手抄密钥后输一次验证器里的 6 位码完成绑定，并拿到 10 个一次性备用码（关掉面板就再也看不到）；也可以选「用邮箱验证码开启」。之后登录时密码对了会切到输码步骤且**还没有登录态**，用验证器里的码或备用码都能进首页，同一枚备用码第二次会被拒；用管理员账号可以在「管理 → 用户」里替他关闭两步验证。
15. 用户在「安全」里更换邮箱：验证码发到新地址、通过后才生效，个人资料表单里没有邮箱字段；关闭两步验证需要输入当前密码。

## 路线图与已知限制

- **应用必须连后端**：数据只在 PostgreSQL 里，没起后端（或没做 `adb reverse`）时页面会显示连接失败与排查提示，不做离线降级。开发时可用 `pwsh -File scripts\db.ps1 start` + `npm run dev`，并打开 `http://127.0.0.1:3000/status` 确认各检查项。
- 视频只限大小与后缀，不做转码与压缩：超过「管理-设置」里的视频大小上限会被拒（默认 50 MB，原生复制过程中也会数着字节，避免写满数据分区），但不会转码成通用码率，弱网/老设备播放不保证。
- 媒体文件保存到应用私有目录 `files/media` 并通过短 URL 引用，属于设备本地存储；卸载应用会一并清除，换设备不同步。
- 通知只有落库与权限申请：事件发生在服务端，应用不在前台时不会收到本地推送（需要 FCM 或轮询）。
- 后端没有对外开放部署（无 HTTPS、无签名校验），示例密钥与 `postgres/postgres` 只适合本机开发；上线要做的清单与开销见下面「上线部署清单与开销」一节。
- 继续补齐前端页面的无障碍检查，并把剩余硬编码文案迁移到 `strings.xml`。

## 上线部署清单与开销

代码做完不等于用户能用：**后端目前没有对外开放部署**（无 HTTPS、无域名、`CORS_ORIGIN=*`），而邮箱验证码体系要真正跑起来必须先上线 —— 验证码得能发到真实用户的邮箱，注册、找回密码与两步验证才有意义。下面按「必须先做 / 上线时做 / 上线后观察」三档列出；成本按**已有域名与公网服务器**估算，纯本地开发不需要其中任何一项。

### 必须先做（不做就不能对外）

| 项 | 做法 | 成本 |
| --- | --- | --- |
| HTTPS + 反向代理 | Caddy（自动申请 Let's Encrypt 证书）或 Nginx + certbot，反代到 `127.0.0.1:3000` | ¥0 |
| 客户端改回严格模式 | `WebShellActivity` 的 `MIXED_CONTENT_ALWAYS_ALLOW` 改回 `NEVER_ALLOW`；`js/core/api.js` 的 `BASE_URL` 指向 `https://api.<域名>/api/v1`；顺手清掉 manifest 里不再需要的明文放行 | ¥0，但要重新出包 |
| 收紧 CORS | `CORS_ORIGIN` 从 `*` 改为 WebView 的起源（`https://appassets.androidplatform.net`），`credentials` 保持 false | ¥0 |
| 换掉示例密钥 | `JWT_SECRET` / `JWT_REFRESH_SECRET` 换成随机值（`openssl rand -hex 32`），数据库密码别再是 `postgres/postgres`；**再配一个 `TOTP_SECRET_KEY`** 并长期保管（验证器密钥用它加密，换掉它用户得重新绑定） | ¥0 |
| **保护 `/status` 与 `/api/v1/status`** | **已内置**：`npm start` 进生产模式后这两个接口直接 404（它们会暴露迁移清单、各表行数与接口清单，失败时还带 pg 的错误原文）。确实需要时用 `ENABLE_STATUS_PAGE=true` 打开，并靠反代加 Basic Auth / IP 白名单；对外探活只留 `/ping` | ¥0 |
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
| 部署顺序 | `npm ci` → `npm run db:migrate` → 重启进程；迁移幂等，**先迁移再重启** | ¥0 |
| 重新出包 | 上面的客户端改动 + 域名一起发版；Android 侧还要把 `usesCleartextTraffic` 与明文说明去掉 | ¥0 |

### 上线后观察

- **启动日志**：`npm start` 会打印「运行模式：production」「状态页：已关闭」以及配置自检的警告项；致命项（开发密钥、默认库密码、验证码只写日志）会直接拒绝启动 —— 这是上线前最后一道机器检查。
- 需要排查时临时开一次状态页：`ENABLE_STATUS_PAGE=true npm start`（或在 `.env` 里打开），查完记得关掉。
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

### 隐私与合规

邮箱属于个人信息，对外收集必须给告知与同意：需要补一页隐私政策（收集什么、用来做什么、保留多久、如何删除），注册页明确告知「邮箱用于接收验证码与账号安全通知」。以后若加**通知类**邮件（报名结果、展会提醒），要提供退订入口 —— 验证码这类事务型邮件不需要退订，营销与提醒类需要。以上是工程侧的检查项，具体合规结论以法务意见为准。

## 待裁决清单（未决项）

以下是与设计稿或现有数据模型还不一致、尚未拍板的地方；其余分歧已按「以线框为准、缺的能力在桥接层补齐」处理完毕，不再记录。相关的当前行为分别写在「已实现的关键交互」「架构与数据边界」与 `server/README.md` 里。

| 条目 | 当前行为 | 待确认 |
| --- | --- | --- |
| 报名方式的历史数据 | 状态在库里存英文代码，中文标签只在 `server/src/domain/labels.js` 映射一次 | 是否需要一次性数据迁移，把历史的旧状态值改写为具体报名方式 |
| 历史简介的格式 | 统一以 Markdown 保存并记录 `descriptionFormat`，打开编辑器时自动转换、内联图片改写为短 URL | 是否需要一次性把全部历史简介转换并回写 |
| 「修改报名」 | 打开报名页回填已提交的回答，保存时受「已提交过该展会」限制（同一展会只有一条未撤销报名） | 是否需要真正的报名更新接口 |
| 视频上传 | 走系统选择器，格式与数量按服务器设置校验，只在设备侧落盘 | 是否接入服务端媒体存储与上传接口 |
| 管理员角色 | `admin` 即超级管理员，权限不细分 | 是否需要独立超级管理员与更细的角色 |
| 设计稿 16/17 屏 | 内容内联到管理后台与个人页，没有独立二级页面 | 是否需要保留独立入口 |
| 示例数据规模 | 4 场**相对今天**生成的展会，`db:seed` 可反复执行 | 是否需要更多示例展会或按分类铺开 |