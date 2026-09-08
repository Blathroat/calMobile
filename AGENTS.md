# Repository Guidelines

## 项目结构

Android 客户端位于 `app/`，采用 Java 与 XML；入口为 `LoginActivity`，首页在 `MainActivity`。界面资源在 `app/src/main/res/`，单元测试在 `app/src/test/`。`server/` 是独立的 Node.js/Express 与 PostgreSQL 服务，并非 Gradle 模块。保留 `TODO.md`，实现与其冲突时以可执行配置为准。

## 构建、测试与开发

在仓库根目录运行：

```bash
node scripts/smoke-check.js             # 静态结构检查
gradlew.bat :app:testDebugUnitTest      # Android 单元测试（Windows）
gradlew.bat :app:assembleDebug          # 生成调试 APK
```

POSIX 环境将 `gradlew.bat` 改为 `./gradlew`。后端进入 `server/` 后使用 `npm run dev` 启动，`npm test -- --runInBand` 测试，`npm run lint` 检查代码；先根据 `.env.example` 配置本地 PostgreSQL，绝不提交 `.env` 或凭据。

## 编码与界面规范

保持 Java 17、四空格缩进和 Java/XML 现有目录结构。类名使用 PascalCase，方法和资源名使用 camelCase、`snake_case`；界面文案写入 `strings.xml`，新增注释和文档使用中文。沿用深海蓝、青绿色和浅雾白的视觉令牌，触摸操作应提供明确的选中、禁用或完成反馈。

## 测试与提交

Android 改动依次运行静态检查、单元测试和调试构建；聚焦测试使用 `:app:testDebugUnitTest --tests '包名.测试类'`。提交信息使用简洁中文动词短句，例如 `优化首页日期联动`。合并请求说明用户可见变化、验证命令及结果；涉及界面时附截图，关联对应问题。

## 架构与工作区

当前活动路径混用 SQLite、本地示例数据和内存会话；`database/`、`network/`、`repository/`、`viewmodel/` 的 Room/Retrofit 栈尚未接入主界面。变更认证、持久化、导航框架、包名或签名策略前先确认。工作区可能有其他修改，只检查和提交本次涉及路径，禁止回退无关文件。
