# CalMobile

一个用于展会日程、报名和管理的 Android 移动应用。

## 概述

CalMobile 是一款使用 Java 构建的原生 Android 应用，提供完整的展会管理解决方案。它支持展会浏览、访客报名、展商后台管理和管理员控制。

## 功能

### 核心功能
- **展会日历**：按月展示展会，并在日期上显示标记
- **展会详情**：展示丰富的展会信息和状态标识
- **报名系统**：支持带自定义字段的访客报名
- **我的报名**：查看和管理个人报名记录

### 用户功能
- **用户资料**：个人资料、简介、联系方式和社交媒体信息
- **公开资料**：查看其他用户的公开资料
- **报名历史**：跟踪展会参与历史

### 展商功能
- **展商后台**：创建、编辑和删除展会
- **报名管理**：审核并通过/拒绝访客报名
- **展会状态控制**：管理展会状态（open、closed、ended）

### 管理员功能
- **用户管理**：查看、封禁、限制和管理用户账号
- **展会管理**：统一管理所有展会，并支持锁定/解锁
- **数据导出**：将展会、报名和用户数据导出为 CSV

### 增强功能
- **SQLite 数据库**：为所有数据提供本地持久化存储
- **认证系统**：用户注册和登录
- **富文本查看器**：为展会描述提供 HTML 渲染
- **搜索功能**：搜索展会和用户
- **通知系统**：展会提醒和报名更新
- **日历集成**：将展会添加到设备日历
- **底部导航**：为首页、个人、展商和管理提供固定 4 标签导航，并在标签间左右滑动切换
- **首页顶部搜索入口**：在首页顶部直接进入搜索流程
- **个人账号入口**：退出登录迁移到个人页底部，访客仅保留首页与展会详情浏览能力
- **独立详情流程**：展会详情和报名表单作为独立 Activity 页面运行
- **UI 动画**：平滑过渡和列表动画

## 截图

*即将补充*

## 架构

详细架构信息请查看 [ARCHITECTURE.md](ARCHITECTURE.md)。

最新项目 review 和优先级改进 backlog 请查看 [docs/PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md)。

### 项目结构

```
calMobile/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/example/calmobile/
│   │   │   │   ├── Activities（UI 层）
│   │   │   │   ├── Managers（业务逻辑）
│   │   │   │   ├── Models（数据模型）
│   │   │   │   └── Helpers（工具类）
│   │   │   ├── res/
│   │   │   │   ├── layout/（XML 布局）
│   │   │   │   ├── values/（字符串、颜色、主题）
│   │   │   │   ├── anim/（动画）
│   │   │   │   └── drawable/（Drawable 资源）
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

## 前置要求

- Android Studio Arctic Fox 或更高版本
- JDK 8 或更高版本
- 已安装 API 30 的 Android SDK
- Gradle 7.6.4（已通过 wrapper 包含）

## 设置说明

### 1. 克隆仓库

```bash
git clone https://github.com/Blathroat/calMobile.git
cd calMobile
```

### 2. 在 Android Studio 中打开

1. 启动 Android Studio
2. 选择 “Open an existing project”
3. 导航到克隆后的目录并点击 “OK”
4. 等待 Gradle sync 完成

### 3. 配置 SDK

1. 进入 File → Project Structure → SDK Location
2. 确认 Android SDK location 设置正确
3. 在 SDK Manager 中确认已安装 API 30

## 构建说明

### 使用 Android Studio

1. 选择 Build → Make Project（或按 Ctrl+F9）
2. 等待构建完成
3. 在 Build Output 中检查是否有错误

### 使用命令行

```bash
# Windows
gradlew.bat :app:assembleDebug

# Linux/Mac
./gradlew :app:assembleDebug
```

### 构建变体

- **debug**：带调试符号的开发构建
- **release**：生产构建（需要签名配置）

## 运行应用

### 在模拟器上运行

1. 在 Device Manager 中创建 AVD（Android Virtual Device）
2. 选择 API 30 或更高版本的设备
3. 点击 Run → Run 'app'（或按 Shift+F10）
4. 选择模拟器并点击 OK

### 在真机上运行

1. 在设备上启用开发者选项
2. 启用 USB Debugging
3. 通过 USB 连接设备
4. 点击 Run → Run 'app'（或按 Shift+F10）
5. 选择你的设备并点击 OK

## 测试账号

应用预置了以下测试账号，用于不同权限级别的测试：

| 用户名 | 密码 | 角色 | 权限说明 |
|--------|------|------|----------|
| `demo` | `password` | 管理员 (ROLE_ADMIN) | 拥有所有权限：首页、个人、展商后台、管理后台 |
| `exhibitor` | `password` | 展商 (ROLE_EXHIBITOR) | 可访问：首页、个人、展商后台 |
| `user` | `password` | 普通用户 (ROLE_USER) | 可访问：首页、个人 |
| `guest` | - | 访客 | 仅可浏览首页和展会详情，点击个人页会跳转登录 |

### 权限层级

- **访客**：未登录状态，可浏览首页日历、展会详情，但不能报名或访问个人/展商/管理页面
- **普通用户**：登录后可报名展会、查看个人资料和报名记录
- **展商**：除普通用户权限外，还可管理自己创建的展会（编辑、删除、查看报名）
- **管理员**：拥有所有权限，可管理所有用户和展会，锁定/解锁展会，导出数据

## 测试

### 运行单元测试

```bash
# Windows
gradlew.bat :app:testDebugUnitTest

# Linux/Mac
./gradlew :app:testDebugUnitTest
```

### 测试覆盖

项目包含 15 个测试文件，覆盖：

- **单元测试**：
  - AuthManagerTest
  - DatabaseHelperTest
  - ExhibitionManagerTest
  - RegistrationManagerTest
  - AdminUserManagerTest
  - ExportManagerTest
  - NotificationHelperTest
  - CalendarHelperTest
  - RichTextViewerTest
  - ExhibitorExhibitionTest
  - AdminUserTest

- **集成测试**：
  - ExhibitionWorkflowIntegrationTest
  - RegistrationWorkflowIntegrationTest
  - SearchWorkflowIntegrationTest
  - UserManagementWorkflowIntegrationTest

### Smoke Test

运行 smoke test 以验证项目结构：

```bash
node scripts/smoke-check.js
```

## 项目状态

### 当前阶段
功能已完成，当前重点是优化和增强。

### 已实现功能
- 带月视图的展会日历（4.1）
- 展会详情展示（4.2）
- 报名表单提交（4.3）
- 带取消功能的我的报名列表（4.4）
- 个人资料和账号设置（4.5）
- 用户公开资料（4.6）
- 展商后台（4.7）
- 报名管理（4.8）
- 管理员后台（4.9）

### 已完成增强
- SQLite 本地持久化
- 本地认证系统
- 富文本查看器
- 搜索功能
- 数据导出（CSV）
- 通知系统
- 日历集成
- 首页固定 4 标签底部导航，切换时保留导航栏
- 首页顶部搜索入口
- 个人页底部退出登录入口和访客权限限制
- 展商/管理后台按钮样式统一
- 独立的展会详情和报名表单 Activity
- UI 动画和样式
- 单元测试覆盖

### 新需求追踪

以下为已确认的新需求，当前已完成代码集成并纳入 smoke-check 静态检查。

- **底部导航移除"更多"标签**：已将底部导航从 5 个标签（首页、个人、展商、管理、更多）缩减为 4 个标签（首页、个人、展商、管理），布局 `layout_bottom_nav.xml` 的 `weightSum` 已改为 4，`nav_more` 已从底部导航移除。
- **访客/权限辅助类**：已新增 `GuestHelper.java` 和 `PermissionHelper.java`，分别提供访客状态判断（`isGuest()`）和基于角色的权限校验（`hasPermission(String)`）。受保护页面继续通过认证/权限入口限制访客访问。
- **二级展会表单页**：已新增 `ExhibitionFormActivity.java` 和 `activity_exhibition_form.xml`，用于展商创建和编辑展会详情。该页面与现有 `RegistrationFormActivity`（访客报名表单）区分，为展商管理专用的独立 Activity。
- **底部导航行为**：4 个标签均分宽度，点击标签时在 `MainActivity` 内容容器中左右滑动切换，并保持底部导航栏可见。

### 最新验证
- `node scripts/smoke-check.js` — 66 项脚手架检查通过（含底部导航、访客/权限辅助类、展会二级表单页检查）
- `gradlew.bat :app:testDebugUnitTest :app:assembleDebug` — BUILD SUCCESSFUL
- ADB 模拟器验证：首页顶部搜索入口、More 页内通知设置、管理后台和展商后台页面可打开并渲染

### 待完成功能
- 网络层（API integration）
- 媒体上传
- 推送通知

## 贡献

### 开发流程

1. 从 `main` 创建 feature branch
2. 进行修改
3. 运行测试，确保没有破坏现有功能
4. 使用描述性信息提交
5. 推送并创建 Pull Request

### 代码风格

- 遵循 Java 命名规范
- 使用有意义的变量名和方法名
- 为 public 方法添加 Javadoc 注释
- 保持方法职责集中且简短

### Commit Messages

使用 conventional commit 格式：
- `feat: add new feature`
- `fix: fix bug`
- `docs: update documentation`
- `test: add tests`
- `refactor: refactor code`

## 依赖

### 当前依赖

- **JUnit 4.13.2**：单元测试（仅 testImplementation）

### 无外部依赖

项目有意仅使用 Android SDK API，以便：
- 最小化 APK 体积
- 减少依赖冲突
- 保持对代码库的完全控制

## 权限

应用请求以下权限：

- `POST_NOTIFICATIONS`：用于展会提醒（API 33+）
- `READ_CALENDAR`：用于日历集成
- `WRITE_CALENDAR`：用于日历集成

## 已知问题

- 认证当前仍在内存中（后续会与 SQLite 集成）
- 示例数据为硬编码（后续会替换为 API 数据）
- 富文本编辑器尚未实现（目前仅有查看器）

## 许可证

本项目为私有项目，未授权公开使用。

## 联系方式

如有问题或需要支持，请联系项目维护者。

## 致谢

- 原始需求来自 TODO.md
- 移动端需求改编自 docs/MOBILE_REQUIREMENTS.md
- 使用 Android SDK 和 Gradle 构建
