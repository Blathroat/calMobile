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
- 已完成的文档：
  - README.md（294 行）
  - ARCHITECTURE.md（627 行）
  - AGENT.md 更新
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
- **MainActivity**: 首页，展示展会月历和详情
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

## 并行开发策略

- 使用 `run_in_background=true` 启动后台任务，避免阻塞主线程
- 同时最多启动 3 个后台 subagent，多余的会自动排队等待
- 任务完成后统一验证和提交
- 不要一次性启动过多任务（如 9 个），3 个为最佳并行数

## Subagent 使用规范

### 指定 subagent 类型
- 使用 `subagent_type` 参数指定具体 agent：
  - `explore`: 代码库探索、文件查找、模式发现
  - `librarian`: 文档查找、外部库研究、最佳实践
  - `oracle`: 架构咨询、复杂调试、技术决策
  - `plan`: 任务规划、工作分解、依赖分析
  - `Metis`: 预规划顾问、需求分析
  - `Momus`: 计划评审、质量检查
- 使用 `category` 参数指定任务类型（当不指定 subagent_type 时）：
  - `visual-engineering`: 前端/UI/布局工作
  - `ultrabrain`: 复杂逻辑、算法、架构
  - `quick`: 简单任务、单文件修改
  - `unspecified-high/low`: 通用任务

### 等待策略（优先级从高到低）
1. **优先使用工具获取状态**：调用 `background_output(task_id="bg_xxx")` 检查任务是否完成
2. **阻断等待**：如果任务未完成，使用 `block=true` 参数阻断等待结果
3. **结束对话**：只有在无法阻断时才结束对话等待 `<system-reminder>` 通知

### 并行执行
- 同时最多 3 个后台任务，多余的会自动排队
- 使用 `run_in_background=true` 启动后台任务
- 任务完成后立即获取结果并验证
- 测试依赖：junit:junit:4.13.2（仅 testImplementation，不进入 APK）。

## 开发与验证

优先验证顺序：

1. 运行 `node scripts/smoke-check.js` 检查项目骨架与文档是否完整。
2. 若 Gradle 可用，运行 `gradle :app:assembleDebug` 或使用 Android Studio 同步并构建。
3. 若以后添加 Gradle Wrapper，优先运行 `gradlew.bat :app:assembleDebug`。
4. 若 adb 可用，安装并打开 App，进行真机或模拟器手动验证。
5. 修改 Java 或 XML 后，检查相关文件诊断并运行相邻测试。

## Git 与 GitHub 流程

- 使用 `git-master` 技能处理所有 Git 操作。
- 每个功能完成后，运行验证后提交并推送到 GitHub。
- 提交信息格式：`feat: 功能简述` 或 `fix: 修复简述`。
- 重要变更前创建分支：`git checkout -b feature/功能名`。

## 范围控制

- 精确实现用户要求，不添加额外功能。
- 发现 TODO.md 之外的需求时，先记录为待确认，不直接实现。
- 不能为了通过验证删除或弱化测试。
- 不要覆盖用户已有文件，尤其是 TODO.md、.idea 配置与 .omo 会话文件。

