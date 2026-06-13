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

- 当前阶段：本地假数据优先的 MVP 原型。
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
- 最近更新：管理后台功能已实现，支持用户管理、展会管理和系统设置
- 后端、认证、数据持久化、媒体上传与富文本编辑均为待确认选型。
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

