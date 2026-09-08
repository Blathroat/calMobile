# AGENT.md

## 沟通规则

- 与用户对话时使用中文。
- 回答保持简洁，先给结论，再给必要细节。
- 重要技术选型必须先询问用户再执行，包括但不限于认证方案、数据库/缓存、富文本/媒体方案、正式包名、发布签名方案。

## 上下文与工具使用

- 优先使用 ctx_* 工具处理搜索、统计、解析、汇总等任务，以节约上下文窗口。
- 需要分析大文件或大量输出时，使用 ctx_execute、ctx_execute_file、ctx_batch_execute 或 ctx_search，避免把原始内容直接灌入对话。
- 只有在需要精确编辑文件时才读取完整文件内容。

## 项目约束

- **项目目标**：Android 移动端展会排期与报名应用。
- **GitHub 仓库**：https://github.com/Blathroat/calMobile
- **原始需求来源**：根目录 TODO.md，不要覆盖或删除该文件。
- **移动端需求文档**：docs/MOBILE_REQUIREMENTS.md。
- **主要语言**：Java。
- **Android SDK**：compileSdk 34、targetSdk 34、minSdk 24、buildToolsVersion 36.0.0（原始需求 API 30 已更新至 API 34）。
- **Gradle**：8.5（通过 wrapper 包含）。
- **Launcher Activity**：LoginActivity（不是 MainActivity）。
- 不要擅自改用 Kotlin、Compose、Flutter、React Native 或其他跨端方案。
- 不要在未确认前引入 Firebase、Hilt、AndroidX Navigation 等新框架。

## 已引入的依赖

以下依赖已在 `app/build.gradle` 中配置，可以使用：

| 类别 | 依赖 |
|------|------|
| AndroidX | appcompat, core-ktx, lifecycle (livedata/viewmodel/runtime), recyclerview, swiperefreshlayout |
| Material | com.google.android.material:material:1.11.0 |
| Database | androidx.room:room-runtime + compiler:2.6.1 |
| Network | retrofit2:2.9.0, converter-gson:2.9.0, okhttp3 logging-interceptor:4.12.0 |
| JSON | com.google.code.gson:gson:2.10.1 |
| Image | com.github.bumptech.glide:glide:4.16.0 |
| Test | junit:4.13.2, espresso-core:3.5.1 |

## 当前工程状态

- **当前阶段**：功能完整，正在优化和增强。
- UI 使用 XML 布局和平台 Activity。
- 已完成代码实现的功能：
  - 底部导航 4 标签（首页/展商/管理/个人）
  - GuestHelper 访客状态判断、PermissionHelper 角色权限校验
  - ExhibitionFormActivity 展商创建/编辑展会
- **待实现功能**：
  - 网络层（API 对接，Retrofit 已引入）
  - 媒体上传
  - 推送通知

## 项目文件结构

```
calMobile/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/example/calmobile/
│   │   │   │   ├── Activities (UI 层，继承 BaseActivity)
│   │   │   │   ├── Managers (业务逻辑，SQLite + 内存双模式)
│   │   │   │   ├── Models (数据模型)
│   │   │   │   └── Helpers (工具类)
│   │   │   ├── res/
│   │   │   │   ├── layout/ (XML 布局)
│   │   │   │   ├── values/ (strings.xml, colors.xml, themes.xml, dimens.xml)
│   │   │   │   ├── anim/ (过渡动画)
│   │   │   │   └── drawable/ (图形资源)
│   │   │   └── AndroidManifest.xml
│   │   └── test/
│   │       └── java/com/example/calmobile/ (单元测试 + 集成测试)
│   └── build.gradle
├── server/ (Node.js 后端，独立运行)
├── scripts/smoke-check.js (57 项静态检查)
├── docs/
├── AGENT.md
├── ARCHITECTURE.md
├── TODO.md
└── MOBILE_REQUIREMENTS.md
```

## 核心类职责

### Activities (UI 层)
- **BaseActivity**: 基类，提供 dp 转换、按钮样式、面板动画、导航等通用方法
- **LoginActivity**: 启动页/登录页（Launcher）
- **MainActivity**: 首页，展会月历 + 4 标签底部导航（首页/展商/管理/个人）
- **ExhibitionDetailActivity**: 展会详情独立页面
- **RegistrationFormActivity**: 报名表单独立页面
- **ExhibitionFormActivity**: 展商创建/编辑展会的二级表单页
- **ProfileActivity**: 个人主页和账号设置（含退出登录）
- **UserPublicActivity**: 用户公开页面
- **ExhibitorBackendActivity**: 展商后台
- **RegistrationManagementActivity**: 报名管理
- **AdminBackendActivity**: 管理后台
- **SearchActivity**: 搜索页面

### Managers (业务逻辑)
- **ExhibitionManager**: 展会 CRUD，SQLite + 内存双模式
- **RegistrationManager**: 报名 CRUD，SQLite + 内存双模式
- **AdminUserManager**: 用户管理，SQLite + 内存双模式
- **AuthManager**: 认证管理（当前为内存存储）

### Models (数据模型)
- **ExhibitorExhibition**: 展会模型
- **Registration**: 报名模型
- **AdminUser**: 用户模型

### Helpers (工具类)
- **DatabaseHelper**: SQLite 数据库单例
- **NotificationHelper**: 通知管理
- **CalendarHelper**: 日历集成
- **ExportManager**: CSV 数据导出
- **RichTextViewer**: HTML 富文本渲染
- **GuestHelper**: 访客状态判断（isGuest()）
- **PermissionHelper**: 角色权限校验（hasPermission()）

## 开发与验证

优先验证顺序：

1. `node scripts/smoke-check.js` — 57 项静态检查（项目骨架、文档、导航、权限辅助类）
2. `gradlew.bat :app:testDebugUnitTest` — 单元测试
3. `gradlew.bat :app:assembleDebug` — 构建 APK
4. ADB 模拟器验证（如可用）

修改 Java 或 XML 后，检查相邻测试并运行 smoke-check。

## Git 与 GitHub 流程

- 使用 `git-master` 技能处理所有 Git 操作。
- 仅在用户明确要求时提交或推送；提交前必须检查状态、差异和最近提交。
- 提交信息格式：`feat: 功能简述` 或 `fix: 修复简述`。
- 重要变更前创建分支：`git checkout -b feature/功能名`。

## 范围控制

- 精确实现用户要求，不添加额外功能。
- 发现 TODO.md 之外的需求时，先记录为待确认，不直接实现。
- 不能为了通过验证删除或弱化测试。
- 不要覆盖用户已有文件，尤其是 TODO.md、.idea 配置与 .omo 会话文件。

