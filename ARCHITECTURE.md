# CalMobile 架构设计

本文档描述 CalMobile Android 应用的技术架构。

## 目录

1. [概述](#概述)
2. [项目结构](#项目结构)
3. [分层架构](#分层架构)
4. [核心类](#核心类)
5. [数据流](#数据流)
6. [设计模式](#设计模式)
7. [数据库设计](#数据库设计)
8. [UI 架构](#ui-架构)
9. [测试策略](#测试策略)

## 概述

CalMobile 采用分层架构模式，关注点清晰分离：

- **表现层**：Activity 和 XML 布局
- **业务逻辑层**：Manager 类
- **数据层**：数据库帮助类和模型
- **工具层**：辅助功能类

应用仅使用 Android SDK API，除 JUnit 测试外无外部依赖。

## 项目结构

```
app/src/main/java/com/example/calmobile/
├── Activities/
│   ├── BaseActivity.java          # 基类，提供通用 UI 辅助方法
│   ├── MainActivity.java          # 首页，包含日历视图
│   ├── LoginActivity.java         # 登录页面
│   ├── RegisterActivity.java      # 注册页面
│   ├── ProfileActivity.java       # 个人资料和设置
│   ├── UserPublicActivity.java    # 用户公开主页
│   ├── ExhibitorBackendActivity.java  # 展商管理后台
│   ├── RegistrationManagementActivity.java  # 报名管理
│   ├── AdminBackendActivity.java  # 管理员后台
│   └── SearchActivity.java        # 搜索功能
├── Managers/
│   ├── ExhibitionManager.java     # 展会 CRUD 操作
│   ├── RegistrationManager.java   # 报名 CRUD 操作
│   ├── AdminUserManager.java      # 用户管理操作
│   └── AuthManager.java           # 认证逻辑
├── Models/
│   ├── ExhibitorExhibition.java   # 展会数据模型
│   ├── Registration.java          # 报名数据模型
│   └── AdminUser.java             # 用户数据模型
├── Helpers/
│   ├── DatabaseHelper.java        # SQLite 数据库单例
│   ├── NotificationHelper.java    # 通知管理
│   ├── CalendarHelper.java        # 日历集成
│   ├── ExportManager.java         # CSV 数据导出
│   └── RichTextViewer.java        # HTML 文本渲染
└── CalMobileApp.java              # Application 类
```

## 分层架构

### 表现层

**职责：**
- 显示 UI 元素
- 处理用户交互
- 页面间导航
- 显示业务逻辑层的数据

**核心组件：**
- Activity（UI 页面）
- XML 布局（UI 结构）
- 动画（UI 过渡）

**通信方式：**
- 接收用户输入
- 调用 Manager 方法
- 观察数据变化
- 更新 UI

### 业务逻辑层

**职责：**
- 实现业务规则
- 协调数据操作
- 管理应用状态
- 处理数据验证

**核心组件：**
- ExhibitionManager
- RegistrationManager
- AdminUserManager
- AuthManager

**通信方式：**
- 接收 Activity 的调用
- 调用 DatabaseHelper 进行数据操作
- 返回结果给 Activity

### 数据层

**职责：**
- 持久化数据
- 检索数据
- 管理数据库结构
- 处理数据迁移

**核心组件：**
- DatabaseHelper（SQLite）
- SharedPreferences（设置）
- 内存存储（回退方案）

**通信方式：**
- 接收 Manager 的调用
- 执行 CRUD 操作
- 返回数据给 Manager

### 工具层

**职责：**
- 提供通用功能
- 处理系统集成
- 格式化和显示数据
- 导出数据

**核心组件：**
- NotificationHelper
- CalendarHelper
- ExportManager
- RichTextViewer

## 核心类

### BaseActivity

**位置：** `app/src/main/java/com/example/calmobile/BaseActivity.java`

**职责：**
- 提供通用 UI 辅助方法
- 处理尺寸转换
- 创建样式化 TextView
- 管理卡片样式
- 处理面板动画
- 显示空状态
- 显示确认对话框
- 管理导航过渡

**核心方法：**
- `dp(int value)`：dp 转像素
- `fullWidthParams(int topMarginDp)`：创建布局参数
- `addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style)`：创建样式化 TextView
- `styleCard(LinearLayout card)`：应用卡片样式
- `animateShowPanel(View panel)`：面板显示动画
- `animateHidePanel(View panel)`：面板隐藏动画
- `animateListItems(LinearLayout container, int startDelay)`：列表项动画
- `showEmptyState(LinearLayout container, String message)`：显示空状态
- `showConfirmDialog(String message, Runnable onConfirm)`：显示确认对话框
- `navigateTo(Class<? extends Activity> activityClass)`：导航到 Activity

### DatabaseHelper

**位置：** `app/src/main/java/com/example/calmobile/DatabaseHelper.java`

**职责：**
- 管理 SQLite 数据库
- 处理数据库创建和升级
- 提供所有表的 CRUD 操作
- 生成顺序 ID

**核心方法：**
- `init(Context context)`：初始化单例
- `getInstance()`：获取单例实例
- `insertExhibition(...)`：插入展会
- `updateExhibition(...)`：更新展会
- `deleteExhibition(String id)`：删除展会
- `getAllExhibitions()`：获取所有展会
- `getExhibitionById(String id)`：根据 ID 获取展会
- `searchExhibitions(String query)`：搜索展会
- `insertRegistration(...)`：插入报名
- `updateRegistrationStatus(...)`：更新报名状态
- `getAllRegistrations()`：获取所有报名
- `insertUser(...)`：插入用户
- `updateUserStatus(...)`：更新用户状态
- `getAllUsers()`：获取所有用户
- `searchUsers(String query)`：搜索用户

### ExhibitionManager

**位置：** `app/src/main/java/com/example/calmobile/ExhibitionManager.java`

**职责：**
- 管理展会业务逻辑
- 与 DatabaseHelper 协调
- 提供内存存储回退
- 初始化示例数据

**核心方法：**
- `ensureInitialized()`：使用示例数据初始化
- `add(...)`：添加展会
- `update(...)`：更新展会
- `delete(String id)`：删除展会
- `updateStatus(String id, String newStatus)`：更新状态
- `listAll()`：列出所有展会
- `findById(String id)`：根据 ID 查找
- `search(String query)`：搜索展会
- `getRegistrationRecords(ExhibitorExhibition exhibition)`：获取报名记录

### RegistrationManager

**位置：** `app/src/main/java/com/example/calmobile/RegistrationManager.java`

**职责：**
- 管理报名业务逻辑
- 与 DatabaseHelper 协调
- 提供内存存储回退

**核心方法：**
- `submit(...)`：提交报名
- `list()`：列出所有报名
- `cancel(String id)`：取消报名

### AuthManager

**位置：** `app/src/main/java/com/example/calmobile/AuthManager.java`

**职责：**
- 处理用户认证
- 管理用户会话
- 验证凭据

**核心方法：**
- `getInstance()`：获取单例实例
- `register(String username, String password, String email)`：注册用户
- `login(String username, String password)`：用户登录
- `logout()`：用户登出
- `isLoggedIn()`：检查是否已登录
- `getCurrentUsername()`：获取当前用户名
- `getCurrentUserEmail()`：获取当前用户邮箱
- `getUserCount()`：获取用户数量

### NotificationHelper

**位置：** `app/src/main/java/com/example/calmobile/NotificationHelper.java`

**职责：**
- 管理通知渠道
- 发送通知
- 处理通知权限
- 存储通知设置

**核心方法：**
- `getInstance(Context context)`：获取单例实例
- `createNotificationChannels()`：创建通知渠道
- `hasNotificationPermission()`：检查通知权限
- `requestNotificationPermission(Activity activity)`：请求权限
- `sendExhibitionReminder(...)`：发送展会提醒
- `sendRegistrationStatusNotification(...)`：发送报名状态通知
- `sendRegistrationConfirmation(...)`：发送报名确认
- `isExhibitionReminderEnabled()`：检查提醒是否启用
- `setExhibitionReminderEnabled(boolean enabled)`：启用/禁用提醒
- `isRegistrationUpdatesEnabled()`：检查更新是否启用
- `setRegistrationUpdatesEnabled(boolean enabled)`：启用/禁用更新
- `getHistory()`：获取通知历史
- `clearHistory()`：清除通知历史

### CalendarHelper

**位置：** `app/src/main/java/com/example/calmobile/CalendarHelper.java`

**职责：**
- 管理日历集成
- 添加/删除日历事件
- 处理日历权限
- 跟踪日历事件映射

**核心方法：**
- `hasCalendarPermissions(Context context)`：检查日历权限
- `requestCalendarPermissions(Activity activity)`：请求权限
- `addToCalendar(...)`：添加展会到日历
- `isInCalendar(Context context, String title, int day)`：检查是否在日历中
- `removeFromCalendar(...)`：从日历移除
- `parseTimeRange(int day, String time)`：解析时间范围

### ExportManager

**位置：** `app/src/main/java/com/example/calmobile/ExportManager.java`

**职责：**
- 导出数据为 CSV
- 处理文件写入
- 格式化 CSV 数据

**核心方法：**
- `exportExhibitions(Context context)`：导出展会
- `exportRegistrations(Context context)`：导出报名
- `exportUsers(Context context)`：导出用户
- `escapeCsv(String field)`：转义 CSV 字段

### RichTextViewer

**位置：** `app/src/main/java/com/example/calmobile/RichTextViewer.java`

**职责：**
- 解析 HTML 标签
- 应用文本样式
- 处理链接
- 渲染富文本

**核心方法：**
- `setText(TextView textView, String text, Context context)`：设置富文本
- `containsHtml(String text)`：检查是否包含 HTML
- `parseHtml(String text, Context context)`：解析 HTML
- `extractAttr(String tag, String attrName)`：提取属性

## 数据流

### 展会浏览流程

```
用户 → MainActivity → ExhibitionManager → DatabaseHelper → SQLite
                ↓
        MainActivity.updateUI()
```

1. 用户打开应用
2. MainActivity 调用 ExhibitionManager.listAll()
3. ExhibitionManager 调用 DatabaseHelper.getAllExhibitions()
4. DatabaseHelper 查询 SQLite 数据库
5. 数据沿链路返回
6. MainActivity 更新 UI

### 报名流程

```
用户 → MainActivity → RegistrationManager → DatabaseHelper → SQLite
                ↓
        MainActivity.updateUI()
                ↓
        NotificationHelper.sendRegistrationConfirmation()
```

1. 用户填写报名表单
2. MainActivity 调用 RegistrationManager.submit()
3. RegistrationManager 调用 DatabaseHelper.insertRegistration()
4. DatabaseHelper 插入 SQLite
5. 报名数据沿链路返回
6. MainActivity 更新 UI
7. NotificationHelper 发送确认通知

### 认证流程

```
用户 → LoginActivity → AuthManager → 内存存储
                ↓
        LoginActivity.navigateToMain()
```

1. 用户输入凭据
2. LoginActivity 调用 AuthManager.login()
3. AuthManager 验证凭据
4. AuthManager 更新会话
5. LoginActivity 导航到 MainActivity

## 设计模式

### 单例模式

用于：
- DatabaseHelper
- AuthManager
- NotificationHelper

**实现：**
```java
private static DatabaseHelper instance;

public static synchronized DatabaseHelper getInstance() {
    return instance;
}

public static synchronized void init(Context context) {
    if (instance == null) {
        instance = new DatabaseHelper(context.getApplicationContext());
    }
}
```

### Manager 模式

用于：
- ExhibitionManager
- RegistrationManager
- AdminUserManager

**实现：**
```java
public class ExhibitionManager {
    public static List<ExhibitorExhibition> listAll() {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getAllExhibitions();
        }
        return new ArrayList<>(fallbackExhibitions);
    }
}
```

### 双存储模式

所有 Manager 同时支持 SQLite 和内存存储：

```java
public static List<ExhibitorExhibition> listAll() {
    DatabaseHelper dbHelper = DatabaseHelper.getInstance();
    if (dbHelper != null) {
        return dbHelper.getAllExhibitions();
    }
    return new ArrayList<>(fallbackExhibitions);
}
```

### 模板方法模式

BaseActivity 为通用 UI 操作提供模板方法：

```java
public abstract class BaseActivity extends Activity {
    protected int dp(int value) { ... }
    protected LinearLayout.LayoutParams fullWidthParams(int topMarginDp) { ... }
    protected TextView addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style) { ... }
    protected void styleCard(LinearLayout card) { ... }
    protected void animateShowPanel(View panel) { ... }
    protected void animateHidePanel(View panel) { ... }
    protected void animateListItems(LinearLayout container, int startDelay) { ... }
    protected void showEmptyState(LinearLayout container, String message) { ... }
    protected void showConfirmDialog(String message, Runnable onConfirm) { ... }
    protected void navigateTo(Class<? extends Activity> activityClass) { ... }
}
```

## 数据库设计

### 展会表

```sql
CREATE TABLE exhibitions (
    _id TEXT PRIMARY KEY,
    day INTEGER NOT NULL,
    title TEXT NOT NULL,
    venue TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT ''
);
```

### 报名表

```sql
CREATE TABLE registrations (
    _id TEXT PRIMARY KEY,
    exhibition_title TEXT NOT NULL,
    exhibition_day INTEGER NOT NULL,
    exhibition_time TEXT NOT NULL,
    exhibition_venue TEXT NOT NULL,
    visitor_name TEXT NOT NULL,
    visitor_type TEXT NOT NULL,
    needs_summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL
);
```

### 用户表

```sql
CREATE TABLE users (
    _id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    registration_time TEXT NOT NULL DEFAULT '',
    last_login_time TEXT NOT NULL DEFAULT ''
);
```

## UI 架构

### Activity 生命周期

所有 Activity 遵循标准 Android 生命周期：
1. onCreate() - 初始化 UI
2. onStart() - Activity 变为可见
3. onResume() - Activity 变为可交互
4. onPause() - Activity 失去焦点
5. onStop() - Activity 变为不可见
6. onDestroy() - Activity 被销毁

### 导航

导航使用显式 Intent 和滑动动画：

```java
protected void navigateTo(Class<? extends Activity> activityClass) {
    startActivity(new Intent(this, activityClass));
    overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
}
```

### UI 组件

- **LinearLayout**：垂直/水平布局的主要容器
- **GridLayout**：日历网格显示
- **TextView**：文本显示
- **Button**：用户交互
- **EditText**：文本输入
- **RadioGroup/RadioButton**：单选
- **CheckBox**：多选
- **ScrollView**：可滚动内容

### 动画

位于 `app/src/main/res/anim/`：
- `fade_in.xml`：淡入动画
- `fade_out.xml`：淡出动画
- `slide_in_left.xml`：从左侧滑入
- `slide_in_right.xml`：从右侧滑入
- `slide_out_left.xml`：向左侧滑出
- `slide_out_right.xml`：向右侧滑出

## 测试策略

### 单元测试

位于 `app/src/test/java/com/example/calmobile/`：

- **AuthManagerTest**：认证逻辑
- **DatabaseHelperTest**：数据库操作
- **ExhibitionManagerTest**：展会管理
- **RegistrationManagerTest**：报名管理
- **AdminUserManagerTest**：用户管理
- **ExportManagerTest**：数据导出
- **NotificationHelperTest**：通知
- **CalendarHelperTest**：日历集成
- **RichTextViewerTest**：富文本渲染
- **ExhibitorExhibitionTest**：展会模型
- **AdminUserTest**：用户模型

### 集成测试

- **ExhibitionWorkflowIntegrationTest**：完整展会工作流
- **RegistrationWorkflowIntegrationTest**：完整报名工作流
- **SearchWorkflowIntegrationTest**：搜索功能
- **UserManagementWorkflowIntegrationTest**：用户管理工作流

### 冒烟测试

位于 `scripts/smoke-check.js`：
- 验证项目结构
- 检查必需文件是否存在
- 验证文件内容
- 确保文档完整

## 性能考虑

### 数据库优化

- 频繁查询列添加索引
- 重复操作使用预编译语句
- 通过单例模式实现连接池

### UI 优化

- 列表中的视图复用
- 大数据集的懒加载
- 硬件加速的动画优化

### 内存管理

- 重量级对象使用单例模式
- 正确处理 Activity 生命周期
- 图片的 Bitmap 回收

## 安全考虑

### 数据存储

- SQLite 数据库存储在应用私有目录
- SharedPreferences 用于敏感设置
- 敏感数据不存储在外部存储

### 认证

- 内存会话管理
- 客户端密码验证
- 日志中不记录敏感数据

### 权限

- 运行时权限请求
- 权限拒绝时优雅降级
- 清晰的权限说明

## 未来考虑

### 网络层

- API 集成获取远程数据
- 离线优先架构
- 数据同步

### 媒体上传

- 图片/视频压缩
- 进度跟踪
- 错误处理

### 推送通知

- Firebase Cloud Messaging
- 通知渠道
- 后台处理

## 总结

CalMobile 采用清晰的分层架构，关注点明确分离。仅使用 Android SDK API 确保了最小依赖和对代码库的完全控制。双存储模式（SQLite + 内存）为测试和未来扩展提供了灵活性。
