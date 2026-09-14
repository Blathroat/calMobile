# Repository Guidelines

## 项目结构

Android 客户端位于 `app/`，使用 Java 17 与 XML View；启动页是 `LoginActivity`，主容器是 `MainActivity`。页面资源在 `app/src/main/res/`，单元测试在 `app/src/test/`。`server/` 是独立的 Node.js、Express 与 PostgreSQL 服务，不属于 Gradle 模块。项目说明、架构、需求、设计令牌和路线图统一维护在根目录 `README.md`，后端运行细节维护在 `server/README.md`。

## 构建、测试与开发

在仓库根目录运行：

```bash
node scripts/smoke-check.js
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug
```

POSIX 环境使用 `./gradlew`。后端进入 `server/` 后运行 `npm install`、`npm run db:migrate`、`npm run dev`；测试使用 `npm test -- --runInBand`，风格检查使用 `npm run lint`。本地 PostgreSQL 配置参考 `server/.env.example`，禁止提交 `.env`、密钥或真实用户数据。

## 编码与界面规范

Java 与 XML 使用四空格缩进；类名使用 PascalCase，方法、变量使用 camelCase，资源名使用 `snake_case`。用户可见文案放入 `strings.xml`，新增文档和注释使用中文。沿用 newUI 令牌（`#F7F6F3` 背景、`#FFFFFF` 页面、`#20252B` 主文字、`#626A74` 次文字、`#C5CAD1` 描边、`#48515D` 主按钮、`#C05621` 强调色），优先使用 8/12dp 圆角卡片、明确的状态标签和至少 48dp 的触控区域。日期、时间和状态选择使用页内卡片或选择器，不使用下划线输入框；动态展开内容必须出现在触发卡片附近，并提供选中、禁用、错误和完成反馈。

## 测试与提交

Android 改动按 smoke-check、单元测试、调试构建的顺序验证；聚焦测试可使用 `:app:testDebugUnitTest --tests '包名.测试类'`。涉及界面时使用可用的模拟器进行 ADB 回归。提交信息使用简洁中文动词短句，例如 `优化展会日期选择`。合并请求需说明用户可见变化、验证命令和结果；界面改动附截图或录屏并关联问题。

## 架构与工作区

当前客户端以 Activity/XML + Manager 为主，展会、报名和用户数据使用 SQLite，并在数据库不可用时回退到内存示例数据；应用设置使用 SharedPreferences。Room、Retrofit、Repository 与 ViewModel 已搭建但尚未接入全部页面，后端 API 也未替换本地演示流。修改认证、持久化、导航、包名、签名或引入新框架前先确认。工作区可能包含其他任务的改动，只检查并提交本次涉及路径，不回退无关文件；`.omo/` 等运行记录不应加入提交。

## 文档维护

新增或更新需求先修改 `README.md`，不要再创建重复的需求、架构或 Review 文档。代码行为、依赖或命令变化后同步更新对应说明，并运行 `node scripts/smoke-check.js`。
