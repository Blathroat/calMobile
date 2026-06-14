# AGENT.md

## 沟通规则

- 与用户对话时使用中文。
- 回答保持简洁，先给结论，再给必要细节。
- 重要技术选型必须先询问用户再执行，包括但不限于后端技术栈、认证方案、数据库/缓存、网络库、富文本/媒体方案、正式包名、最低支持 Android 版本、发布签名方案。

## 上下文与工具使用

- 优先使用 ctx_* 工具处理搜索、统计、解析、汇总等任务，以节约上下文窗口。
- 需要分析大文件或大量输出时，使用 ctx_execute、ctx_execute_file、ctx_batch_execute 或 ctx_search，避免把原始内容直接灌入对话。
- 只有在需要精确编辑文件时才读取完整文件内容。

## 项目约束

- 项目目标：Android 移动端展会排期与报名应用。
- GitHub 仓库：https://github.com/Blathroat/calMobile
- 原始需求来源：根目录 TODO.md，不要覆盖或删除该文件。
- 移动端需求文档：docs/MOBILE_REQUIREMENTS.md。
- 主要语言：Java。
- 当前 Android API 30：compileSdk 30、targetSdk 30。
- 不要擅自改用 Kotlin、Compose、Flutter、React Native 或其他跨端方案。
- 不要在未确认前引入 Room、Retrofit、Firebase、Hilt、AndroidX Navigation 等重要依赖或框架。

## 当前工程状态

- 当前阶段：功能完整，正在优化和增强。
- UI 使用 XML 布局和平台 Activity，避免引入未确认依赖。
- 已实现功能（本地假数据）：
  - 首页月视图展会排期（4.1）
  - 展会详情展示（4.2）
  - 报名表单提交（4.3）
  - 我的报名列表与取消功能（4.4）
  - 个人主页与账号设置（4.5）
  - 用户公开页（4.6）
  - 展商后台（4.7）
  - 展会报名管理（4.8）
  - 管理后台（4.9）
- 已完成的增强功能：
  - SQLite 本地持久化
  - 本地认证系统
  - 富文本查看器
  - 搜索功能
  - 数据导出
  - 通知系统
  - 日历集成
  - UI 动画和美化
  - 单元测试覆盖
- 已完成的优化：
  - 更多单元测试（AuthManagerTest, DatabaseHelperTest, ExportManagerTest, NotificationHelperTest, CalendarHelperTest）
  - 代码结构优化（BaseActivity 基类）
  - 集成测试（42 个测试覆盖核心工作流）
  - 真实调试验证（模拟器端到端测试）
- 已完成的 UI 优化：
  - Material Design 3 色彩系统（teal 主色、amber 辅色）
  - 4dp 间距规范（dimens.xml）
  - 组件样式系统（styles.xml）
  - 15 个 drawable 资源（按钮、输入框、卡片、标签等）
  - 9 个布局文件更新
  - 首页固定底部导航栏（首页、个人、展商、管理、更多）
  - 首页顶部搜索入口，可直接进入 SearchActivity
  - 首页日历有展会日期块已做垂直居中修正
  - 更多/账号页面（搜索、通知设置、数据导出提示、退出登录）
  - 更多页通知设置改为页内设置区，不再跳转个人页
  - 展商/管理后台程序化按钮统一使用 CalMobile 按钮样式
  - 展会详情与报名表单独立 Activity 页面
- 已完成的文档：
  - README.md（中文版）
  - ARCHITECTURE.md（627 行，中文版）
  - AGENT.md 更新
  - docs/PROJECT_REVIEW.md 项目 review 与改进清单
- 最近验证：
  - `node scripts/smoke-check.js`：56 项检查通过
  - `gradlew.bat :app:testDebugUnitTest :app:assembleDebug`：BUILD SUCCESSFUL
  - ADB 模拟器验证：`emulator-5554` 可打开首页、更多、管理后台、展商后台；More 通知设置保持在 More 页内
- 待实现功能：
  - 网络层（API 对接）
  - 媒体上传
  - 推送通知

## 项目文件结构

```
calMobile/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/example/calmobile/
│   │   │   │   ├── Activities (UI 层)
│   │   │   │   ├── Managers (业务逻辑)
│   │   │   │   ├── Models (数据模型)
│   │   │   │   └── Helpers (工具类)
│   │   │   ├── res/
│   │   │   │   ├── layout/ (XML 布局)
│   │   │   │   ├── values/ (字符串、颜色、主题)
│   │   │   │   ├── anim/ (动画)
│   │   │   │   └── drawable/ (图形资源)
│   │   │   └── AndroidManifest.xml
│   │   └── test/
│   │       └── java/com/example/calmobile/
│   │           ├── 单元测试
│   │           └── 集成测试
│   └── build.gradle
├── build.gradle
├── settings.gradle
├── gradle/
├── scripts/
│   └── smoke-check.js
├── docs/
│   └── MOBILE_REQUIREMENTS.md
├── AGENT.md
├── ARCHITECTURE.md
├── TODO.md
└── MOBILE_REQUIREMENTS.md
```

## 核心类职责

### Activities (UI 层)
- **BaseActivity**: 基类，提供通用 UI 工具方法
- **MainActivity**: 首页，展示展会月历、展会列表、我的报名和底部导航
- **ExhibitionDetailActivity**: 展会详情独立页面
- **RegistrationFormActivity**: 报名表单独立页面
- **MoreActivity**: 更多/账号页面，提供搜索、通知设置、数据导出提示和退出登录
- **LoginActivity**: 登录页面
- **RegisterActivity**: 注册页面
- **ProfileActivity**: 个人主页和账号设置
- **UserPublicActivity**: 用户公开页面
- **ExhibitorBackendActivity**: 展商后台
- **RegistrationManagementActivity**: 报名管理
- **AdminBackendActivity**: 管理后台
- **SearchActivity**: 搜索页面

### Managers (业务逻辑)
- **ExhibitionManager**: 展会管理，支持 SQLite 和内存存储
- **RegistrationManager**: 报名管理，支持 SQLite 和内存存储
- **AdminUserManager**: 用户管理，支持 SQLite 和内存存储
- **AuthManager**: 认证管理（当前为内存存储）

### Models (数据模型)
- **ExhibitorExhibition**: 展会模型
- **Registration**: 报名模型
- **AdminUser**: 用户模型

### Helpers (工具类)
- **DatabaseHelper**: SQLite 数据库单例
- **NotificationHelper**: 通知管理
- **CalendarHelper**: 日历集成
- **ExportManager**: 数据导出
- **RichTextViewer**: 富文本查看器

## 已知问题

- 认证系统当前为内存存储（后续集成 SQLite）
- 示例数据为硬编码（后续替换为 API 数据）
- 富文本编辑器未实现（仅查看器）

## 开发注意事项

- 所有 Activity 继承自 BaseActivity
- 数据管理类使用 SQLite + 内存双模式
- 测试文件位于 app/src/test/java/com/example/calmobile/
- 运行 `node scripts/smoke-check.js` 验证项目结构

## 开发与验证

优先验证顺序：

1. 运行 `node scripts/smoke-check.js` 检查项目骨架与文档是否完整。
2. 若 Gradle 可用，运行 `gradle :app:assembleDebug` 或使用 Android Studio 同步并构建。
3. 若以后添加 Gradle Wrapper，优先运行 `gradlew.bat :app:assembleDebug`。
4. 若 adb 可用，安装并打开 App，进行真机或模拟器手动验证。
5. 修改 Java 或 XML 后，检查相关文件诊断并运行相邻测试。

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

