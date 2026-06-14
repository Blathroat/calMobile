# CalMobile 项目 Review 与改进清单

更新时间：2026-06-14

## 结论

当前项目已经覆盖移动端展会排期、详情、报名、个人页、展商后台、报名管理和管理后台等核心业务，并已补齐首页顶部搜索、4 标签底部导航、访客权限、展商二级表单页与后台按钮样式统一。数据模型一致性、持久化完整性和测试层级仍有提升空间。

本清单按优先级记录后续可改进点，重点关注 UI/UX。

## P0：优先修复

### 1. 底部导航已接入完整顶层导航体验 [已完成]

- 相关文件：
  - `app/src/main/res/layout/layout_bottom_nav.xml`
  - `app/src/main/java/com/example/calmobile/MainActivity.java`
  - `app/src/main/res/layout/activity_main.xml`
- 当前状态：4 个 tab（首页、个人、展商、管理）已接入 `MainActivity` 内容容器，旧竖向导航按钮和底部"更多"入口已移除；底部导航已显式 `weightSum=4` 并保持等宽入口。
- 已完成：点击底部标签时左右滑动切换内容并保留底部导航，当前 tab 高亮跟随切换，展商/管理入口会按权限隐藏。

### 1a. 底部导航移除"更多"标签 [已完成]

- 相关文件：
  - `app/src/main/res/layout/layout_bottom_nav.xml`
  - `app/src/main/java/com/example/calmobile/MainActivity.java`
  - `app/src/main/java/com/example/calmobile/MoreActivity.java`
- 目标：将底部导航从 5 个标签缩减为 4 个（首页、个人、展商、管理），`weightSum` 从 5 改为 4。
- 原"更多"页功能迁移：通知设置移入个人页或独立设置入口，数据导出和退出登录移入个人页或顶部菜单。
- 状态：布局与 Java 入口均已清理（`weightSum="4"`，`nav_more` 已移除）。smoke-check 对应检查项（`bottom-nav-4-tab`、`no-more-in-bottom-nav`）已通过。

### 1b. 访客/权限辅助类 [已完成]

- 目标文件：
  - `app/src/main/java/com/example/calmobile/GuestHelper.java`
  - `app/src/main/java/com/example/calmobile/PermissionHelper.java`
- 目标：新增 `GuestHelper` 提供 `isGuest()` 方法判断当前用户是否为访客状态；新增 `PermissionHelper` 提供 `hasPermission(String permission)` 方法基于角色（超级管理员、管理员、展商、普通用户）校验操作权限。
- 用途：展商后台、管理后台等受保护页面在入口处调用辅助方法进行访问控制；报名按钮根据权限状态决定是否可点击。
- 状态：`GuestHelper.java` 与 `PermissionHelper.java` 已新增，`AuthManager` 已提供访客、展商和管理员权限判断，smoke-check 对应检查项已通过。

### 1c. 二级展会表单页 [已完成]

- 目标文件：
  - `app/src/main/java/com/example/calmobile/ExhibitionFormActivity.java`
  - `app/src/main/res/layout/activity_exhibition_form.xml`
- 目标：为展商提供独立的展会创建/编辑表单页面，支持填写展会名称、地点、时间、报名方式（需审核/无需审核/仅展示）、展会介绍等内容。
- 与现有 `RegistrationFormActivity`（访客报名表单）区分：`ExhibitionFormActivity` 为展商管理专用，`RegistrationFormActivity` 为访客报名专用。
- 状态：`ExhibitionFormActivity.java` 与 `activity_exhibition_form.xml` 已新增，`ExhibitorBackendActivity` 的新建/编辑入口已改为打开二级页面，smoke-check 对应检查项已通过。

### 2. 首页日历仍是固定 30 天样例

- 相关文件：`app/src/main/java/com/example/calmobile/MainActivity.java`
- 当前状态：有展会日期块已做垂直居中修正。
- 问题：`MONTH_DAYS = 30`、默认展示第 12 天，缺少真实日期、今日高亮和月份切换。
- 建议：引入基于 `java.util.Calendar` 的月份生成逻辑，支持当前月、左右切换和今日状态。

### 3. 搜索结果不可点击

- 相关文件：`app/src/main/java/com/example/calmobile/SearchActivity.java`
- 问题：搜索卡片只展示结果，不能进入展会详情或用户公开页。
- 建议：展会结果跳转 `ExhibitionDetailActivity`，用户结果跳转 `UserPublicActivity`。

### 4. “更多/账号”入口已补齐登出能力

- 相关文件：
  - `app/src/main/java/com/example/calmobile/MainActivity.java`
  - `app/src/main/java/com/example/calmobile/MoreActivity.java`
  - `app/src/main/res/layout/activity_more.xml`
  - `app/src/main/java/com/example/calmobile/AuthManager.java`
- 当前状态：底部“更多”tab 已打开 `MoreActivity`，页面提供通知设置、数据导出提示和退出登录；通知设置使用页内 `NotificationHelper` 偏好和历史区，不再跳转 `ProfileActivity`；登出时调用 `AuthManager.logout()`，并使用清栈 Intent 返回 `LoginActivity`。首页已新增顶部搜索入口。
- 后续建议：将数据导出从提示升级为真实入口，并在允许引入 UI 测试后覆盖完整导航和登出流程。

## P1：UI/UX 体验改进

### 5. 大量界面由 Java 动态创建

- 相关文件：
  - `AdminBackendActivity.java`
  - `ExhibitorBackendActivity.java`
  - `ProfileActivity.java`
  - `SearchActivity.java`
  - `ExhibitionDetailActivity.java`
  - `RegistrationFormActivity.java`
- 当前状态：展商后台与管理后台的程序化按钮已统一调用 `BaseActivity` 按钮样式辅助方法，避免默认 Android 灰色按钮。
- 问题：大量 `new LinearLayout(this)` 和列表项动态生成仍增加维护成本，也不利于布局预览、无障碍检查。
- 建议：优先将稳定结构迁移到 XML，保留列表项和动态内容的必要代码生成。

### 6. 列表未使用 RecyclerView/ListView

- 相关文件：`MainActivity.java`、`AdminBackendActivity.java`、`ExhibitorBackendActivity.java`、`RegistrationManagementActivity.java`、`SearchActivity.java`
- 问题：当前通过 `LinearLayout.addView()` 渲染列表，数据量变大后会造成滚动卡顿和内存压力。
- 建议：若允许引入 AndroidX，可迁移到 RecyclerView；若暂不引入依赖，可先封装复用列表渲染辅助方法。

### 7. 返回按钮和页面头部模式不统一

- 相关文件：多个 `activity_*.xml` 与 Activity 类。
- 问题：部分页面使用 `TextView` 返回按钮，部分页面使用 `Button`；项目启用了 `NoActionBar`，但没有统一 Toolbar 替代方案。
- 建议：抽取统一顶部栏布局或 BaseActivity 辅助方法，统一返回按钮文案、触控区域和过渡动画。

### 8. 无障碍语义仍需补齐

- 相关文件：动态创建 UI 的 Activity 与 XML 布局。
- 问题：程序化创建的卡片、按钮和图标缺少统一 `contentDescription` / 语义说明。
- 建议：为可点击卡片、图标按钮、状态文本补齐无障碍描述，并检查 TalkBack 顺序。

### 9. 部分中文文案仍硬编码在 Java/XML 中

- 相关文件：`RegisterActivity.java`、`ExhibitionDetailActivity.java`、`RegistrationFormActivity.java`、`SearchActivity.java` 等。
- 问题：硬编码文案不利于国际化和统一维护。
- 建议：逐步迁移到 `app/src/main/res/values/strings.xml`。

## P1：工程质量改进

### 10. 认证系统仍为内存存储

- 相关文件：`app/src/main/java/com/example/calmobile/AuthManager.java`
- 问题：用户和登录态在进程结束后丢失，密码为明文内存字段。
- 建议：后续确认认证方案后迁移到 SQLite/安全存储，并增加密码哈希。

### 11. 展会模型重复

- 相关文件：
  - `MainActivity.java` 内部 `Exhibition`
  - `ExhibitorExhibition.java`
- 问题：首页样例展会和展商后台展会不是同一数据源。
- 建议：统一展会模型和数据入口，首页读取 `ExhibitionManager` 数据。

### 12. RegistrationManager 多实例 fallback 数据割裂

- 相关文件：`RegistrationManager.java`、`MainActivity.java`、`RegistrationFormActivity.java`、`ExportManager.java`
- 问题：数据库不可用时，每个 `RegistrationManager` 实例都有独立内存列表。
- 建议：统一为单例或通过依赖注入共享数据源，避免报名数据在不同页面不一致。

### 13. 数据库升级会丢弃数据

- 相关文件：`DatabaseHelper.java`
- 问题：`onUpgrade()` 使用 `DROP TABLE` 重建表。
- 建议：改为版本化迁移脚本，保留用户数据。

### 14. 数据库异常被静默吞掉

- 相关文件：`DatabaseHelper.java`
- 问题：大量 `catch (Exception)` 直接返回默认值，缺少日志和用户提示。
- 建议：至少增加 `Log.e()`，关键操作向 UI 层返回失败原因。

## P2：中长期优化

### 15. 目标 SDK 偏旧

- 相关文件：`app/build.gradle`
- 当前约束为 `targetSdk 30`，暂不擅自修改。
- 建议：后续若面向应用商店发布，需要规划 targetSdk 升级。

### 16. 缺少 UI/Instrumentation 测试

- 相关目录：`app/src/test/java/com/example/calmobile/`
- 问题：当前测试主要覆盖 Manager/Helper/Model，缺少 Activity 和导航流程测试。
- 建议：补充主流程 UI 测试：登录、首页导航、展会详情、报名、取消报名、搜索跳转。

### 17. 深色模式未支持

- 相关目录：`app/src/main/res/values/`
- 问题：仅有亮色主题和单套颜色资源。
- 建议：新增 `values-night/` 并验证主要页面对比度。

## 建议迭代顺序

1. 持续补齐 4 标签底部导航的真机/模拟器回归验证。
2. 将访客/权限辅助类与后续 SQLite 用户角色持久化打通。
3. 为 `ExhibitionFormActivity` 增加更完整的输入校验和单元测试覆盖。
4. 补齐搜索结果跳转，并继续完善"更多/账号"内的数据导出真实入口。
5. 统一首页/展商后台的数据源和展会模型。
6. 修复报名数据管理多实例问题。
7. 外部化硬编码文案，补齐无障碍描述。
8. 增加 UI 测试和真实设备/模拟器截图。
9. 规划 targetSdk、持久化认证和数据库迁移策略。
