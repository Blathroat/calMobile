# CalMobile

CalMobile 是面向展会排期、详情展示、报名和审核的原生 Android 应用。当前版本以本地演示数据为主，已经具备普通用户、展商和管理员的核心操作链路；独立后端和客户端网络接入仍在规划中。

## 文档入口

- `README.md`：唯一的产品说明、需求、架构、界面规范、验收场景和路线图。
- `AGENTS.md`：贡献者与自动化代理的工作约定。
- `server/README.md`：Node.js 服务的数据库配置、启动方式和 API 目录。

历史上的 `TODO.md`、`MOBILE_REQUIREMENTS.md`、`docs/MOBILE_REQUIREMENTS.md`、`ARCHITECTURE.md`、`DESIGN.md`、`docs/PROJECT_REVIEW.md` 和 `AGENT.md` 已在本文件中合并，避免同一需求出现多份版本。

## 产品范围与角色

应用支持访客浏览，登录后根据账号角色显示功能：

- 普通用户：浏览月历、查看展会详情、填写报名、取消报名、维护个人资料和查看公开主页。
- 展商：创建、编辑、删除自己的展会，维护分类、日期、时间、简介和报名收集项，查看报名并进入报名人详情执行审核。
- 管理员：管理用户和全部展会，修改状态、导出 CSV，并设置应用配色、启动公告、展会分类以及是否允许重新审核已通过/已拒绝的报名。产品需求保留超级管理员概念，当前本地演示使用 `admin` 角色覆盖管理权限。

首页提供按月日历、当天展会卡片、顶部搜索和按角色显示的底部导航（首页、个人、展商、管理）。月份可左右滑动，页面切换使用方向一致的滑入/滑出动画。展会详情与报名表单是独立页面；管理操作的状态选择以内嵌卡片显示在触发卡片下方。普通用户可从首页“我的报名”进入独立列表和报名详情。

## 已实现的关键交互

### 展会创建与详情

`ExhibitionFormActivity` 支持名称、地点、开展日期、报名起止日期、开展起止时间、分类、状态和报名收集项。日期与时间使用系统选择器，展示为圆角卡片，不使用下划线输入框。展会简介通过独立的 `RichDescriptionEditorActivity` 编辑，使用 `jp.wasabeef:richeditor-android:2.0.0`，支持标题、粗体、斜体、列表、链接和插入图片；详情页使用 `RichTextViewer` 渲染 HTML。

报名收集项由展商按需新增，支持文本、单选、多选、必填和选项内容。用户报名页只渲染展商配置的项目，报名记录详情会显示完整回答。报名列表点击报名人进入独立详情页，而不是在页面底部追加内容。

### 个人、展商与管理页

个人页直接进入编辑资料和账号设置，用户公开页展示允许公开的信息。展商页的“新建展会”直接打开二级表单；每张展会卡片提供编辑、查看报名、状态选择和删除。管理员展会详情同样提供编辑展会和查看报名入口。搜索结果中的展会和用户卡片均可直接打开对应详情页。

管理设置使用 `AppSettings` 保存本地偏好：八种带 HEX 色号的圆形配色、进入应用时的公告、可编辑的分类列表和审核后重新修改开关。数据导出目前提供展会、报名和用户 CSV 导出入口；媒体数量/大小限制的表单已预留，实际持久化待后端设置模型接入。

## 架构与数据边界

```text
app/src/main/java/com/example/calmobile/
├── *Activity.java       页面与导航（XML 外壳 + 必要的动态卡片）
├── *Manager.java        展会、报名、用户和认证业务
├── database/             Room 实体/DAO 草稿
├── models/               网络与 Room 数据模型
├── network/              Retrofit 接口和客户端
├── repository/           数据仓库草稿
├── viewmodel/            ViewModel 草稿
└── *Helper.java          日历、通知、导出、富文本和权限辅助
```

表现层以 `BaseActivity` 提供的尺寸、卡片、按钮、空状态和过渡动画辅助方法为基础。`MainActivity` 在同一 `FrameLayout` 中缓存并切换四个顶层页面，二级流程通过显式 `Intent` 和统一滑动动画导航。

业务层主要包括 `ExhibitionManager`、`RegistrationManager`、`AdminUserManager` 和 `AuthManager`；`GuestHelper` 与 `PermissionHelper` 负责访客和角色入口判断。展会、报名、用户基础记录由 `DatabaseHelper` 管理 SQLite 三张表；数据库未初始化时各 Manager 使用内存示例数据回退。`AppSettings` 使用 `SharedPreferences` 保存主题、公告、分类和审核偏好。Room、Retrofit、Repository、ViewModel 与 `server/` 已有骨架，但尚未替换本地演示数据源。

逻辑对象包括：

| 对象 | 主要内容 |
| --- | --- |
| Exhibition | 名称、地点、日期、时间、状态、分类、HTML 简介、展商 |
| Registration | 展会、报名人、提交时间、审核状态、表单回答 |
| RegistrationField | 标题、类型（文本/单选/多选）、选项、必填 |
| User | 昵称、邮箱、简介、联系方式、角色、账号状态、公开策略 |
| AppSettings | 配色、启动公告、分类、审核后是否可修改 |

## 技术选型与权限

Android 依赖集中在 `app/build.gradle`：AndroidX、Material、`richeditor-android`、Room、Retrofit/OkHttp、Gson、Glide、JUnit 和 Espresso。当前代码沿用单例（数据库、认证、通知）、Manager（业务协调）和 `BaseActivity` 模板方法等简单模式，保持 Java/XML，不引入 Compose、跨端框架或新的导航容器。

应用声明 `POST_NOTIFICATIONS` 以及读写系统日历所需权限。首次使用日历或通知功能时应在系统提示中授权；拒绝权限时页面仍需保留可用的浏览和报名流程。

### 原生界面与 WebView 的取舍

本版本继续使用 Java/XML 原生界面。WebView 在复用网页组件、快速迭代视觉稿方面更快，但会引入离线资源管理、JavaScript 与 Android 返回栈同步、文件/日历/通知权限桥接、富文本编辑器兼容和无障碍适配成本。当前项目已经拥有可运行的 Activity、SQLite、ADB 与 Gradle 链路，且日期选择、系统日历、通知和文件选择都依赖 Android 能力，因此整体风险与维护成本更低的方案是保留原生壳层；富文本简介仅在编辑区域使用成熟的开源 `RichEditor`。如果后续要同时发布 Web 与 Android，并且后端接口稳定，再考虑把首页和搜索等纯展示模块抽成 WebView 或跨端模块，系统能力相关页面仍保留原生实现。

## 界面设计约定

- 使用 newUI 令牌：背景 `#F7F6F3`、页面白色、主文字 `#20252B`、次文字 `#626A74`、描边 `#C5CAD1`、深石墨主按钮 `#48515D`、橙色强调 `#C05621`；状态必须同时显示文字和颜色。
- 页面采用单列卡片、12dp 圆角、16dp 内边距和 4/8/12/16dp 间距节奏，主要操作清晰，触控区域不小于 48dp。
- 输入控件有可见标签、提示和错误反馈；日期、时间、状态和分类选择采用选择器或内嵌面板。
- 空、加载、错误、成功、禁用状态都要在原位置说明下一步；Toast 不能作为唯一反馈。
- 可点击的用户、展会和图标提供文本或 `contentDescription`，保证 TalkBack 顺序和对比度。

## 构建、测试与运行

环境要求：Android Studio、JDK 17、Android SDK 34、Gradle Wrapper 8.5；Windows 命令如下，Linux/macOS 将 `gradlew.bat` 换为 `./gradlew`。

```bash
# 静态结构检查
node scripts/smoke-check.js

# Android 单元测试与调试 APK
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug

# 运行指定测试
gradlew.bat :app:testDebugUnitTest --tests 'com.example.calmobile.CalendarHelperTest'
```

后端开发请进入 `server/`，按 `server/README.md` 创建 PostgreSQL 数据库并复制 `.env.example`；常用命令为 `npm install`、`npm run db:migrate`、`npm run db:seed`、`npm run dev`、`npm test -- --runInBand` 和 `npm run lint`。

客户端测试位于 `app/src/test/java/com/example/calmobile/`，覆盖认证、数据库、展会、报名、用户管理、导出、通知、日历、富文本和搜索等 Manager/Helper 流程；Activity 级 UI 测试仍在路线图中。

可用模拟器时，可安装并启动调试包：

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.example.calmobile/.LoginActivity
```

预置演示账号：`demo/password`（管理员）、`exhibitor/password`（展商）、`user/password`（普通用户）；未登录用户只能浏览公开展会详情。

## 验收场景

1. 普通用户在月历左右切换月份，点击日期和展会卡片进入详情，填写展商配置的报名项并提交。
2. 展会处于仅展示、截止报名、已结束或管理员暂停状态时，详情页禁用报名并说明原因。
3. 展商从展商页新建展会，进入简介二级编辑器插入图片，选择日期/时间，保存后在详情页看到 HTML 内容。
4. 展商或管理员打开报名列表，点击报名人进入详情页，查看回答并通过或拒绝；允许重新审核时可再次修改状态。
5. 管理员切换圆形 HEX 配色、编辑分类和启动公告，重启首页后设置仍可见。

## 路线图与已知限制

- 将首页、展商和管理页逐步迁移到 RecyclerView/更细的渲染组件，补齐搜索结果到展会详情和用户公开页的跳转。
- 统一 `MainActivity` 的样例数据与 `ExhibitionManager` 数据源，解决报名管理和扩展配置的多实例/内存生命周期问题。
- 接入服务端 API、真实媒体上传和视频处理；把报名收集项、公告、分类及媒体限制纳入持久化模型。
- 为认证增加安全持久化和密码哈希策略，完善 SQLite 版本迁移与异常日志。
- 增加 Activity/导航的 UI 测试、深色主题、无障碍检查，并继续把硬编码文案迁移到 `strings.xml`。

## 变更记录

- 2026-09-14：按 newUI 灰盒规范重构颜色、卡片、表单、首页月历、详情分享、搜索跳转和我的报名列表。
- 2026-09-14：合并重复 Markdown，更新 API 34、富文本编辑、日期时间选择、四项导航、管理员设置和当前限制。
- 2026-09-14：完成展会简介二级富文本编辑器、图片插入以及报名起止日期并排选择。
