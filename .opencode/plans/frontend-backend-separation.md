# CalMobile 前后端分离实施计划

## 概述

将 CalMobile Android 应用从纯本地架构迁移为前后端分离架构：Node.js + Express + PostgreSQL 后端 + Android Retrofit 客户端。同时统一代码风格为中文注释，补充中文文档。

## 当前架构分析

### 代码库清单

| 类别 | 文件数 | 文件 |
|------|--------|------|
| Activity | 14 | MainActivity(1962行), LoginActivity, RegisterActivity, ProfileActivity, ExhibitorBackendActivity, ExhibitionFormActivity, ExhibitionDetailActivity, RegistrationFormActivity, RegistrationManagementActivity, AdminBackendActivity, SearchActivity, UserPublicActivity, MoreActivity, BaseActivity |
| 数据模型 | 3 | ExhibitorExhibition, AdminUser, Registration |
| 管理器 | 4 | ExhibitionManager, RegistrationManager, AdminUserManager, ExportManager |
| 辅助类 | 6 | AuthManager, NotificationHelper, CalendarHelper, PermissionHelper, GuestHelper, RichTextViewer |
| 应用类 | 1 | CalMobileApp |
| 数据库 | 1 | DatabaseHelper (SQLite, 3张表) |

### 关键问题

1. **MainActivity 是 God 类** — 1962行，4个标签页全部用代码构建，无Fragment
2. **Auth 未持久化** — AuthManager 使用 HashMap 内存存储，重启丢失
3. **Profile 未持久化** — 使用静态字段
4. **RegistrationManagement 未持久化** — MgmtRecord 仅内存
5. **双数据源** — SAMPLE_EXHIBITIONS 硬编码 vs SQLite ExhibitionManager
6. **无架构模式** — 无 MVVM/MVP/MVI
7. **无网络层** — 完全离线
8. **密码明文存储** — 无哈希
9. **无外部依赖** — 仅 JUnit

---

## 任务依赖图

| 任务 | 依赖 | 原因 |
|------|------|------|
| T1: 后端项目初始化 | 无 | 起点，无前置条件 |
| T2: 数据库 Schema 设计 | 无 | 可与T1并行 |
| T3: 后端认证模块 (JWT) | T1, T2 | 需要项目结构和数据库 |
| T4: 后端展会 API | T1, T2, T3 | 需要认证中间件 |
| T5: 后端报名 API | T1, T2, T3 | 需要认证中间件 |
| T6: 后端用户 API | T1, T2, T3 | 需要认证中间件 |
| T7: 后端测试 | T3, T4, T5, T6 | 需要 API 实现 |
| T8: Android 网络层 | 无 | 可与后端并行 |
| T9: Android Repository 层 | T8 | 需要网络层 |
| T10: Android ViewModel 层 | T9 | 需要 Repository |
| T11: MainActivity 拆分 | T10 | 需要 ViewModel |
| T12: Android 认证集成 | T8, T3 | 需要网络层和后端认证 |
| T13: Android 数据迁移 | T9, T4, T5, T6 | 需要 Repository 和后端 API |
| T14: 中文注释统一 | 无 | 可随时进行 |
| T15: 中文文档编写 | T3-T13 完成后 | 需要最终代码 |
| T16: 集成测试 | T7, T13 | 需要前后端都完成 |

## 并行执行图

```
Wave 1 (立即开始，无依赖):
├── T1: 后端项目初始化
├── T2: 数据库 Schema 设计
├── T8: Android 网络层基础 (Retrofit + OkHttp)
└── T14: 中文注释统一 (可穿插进行)

Wave 2 (Wave 1 完成后):
├── T3: 后端认证模块 (JWT)
└── T9: Android Repository 层

Wave 3 (Wave 2 完成后):
├── T4: 后端展会 API
├── T5: 后端报名 API
├── T6: 后端用户 API
└── T10: Android ViewModel 层

Wave 4 (Wave 3 完成后):
├── T7: 后端测试
├── T11: MainActivity 拆分
├── T12: Android 认证集成
└── T13: Android 数据迁移

Wave 5 (Wave 4 完成后):
├── T15: 中文文档编写
└── T16: 集成测试

关键路径: T1 → T3 → T4 → T13 → T16
预估并行加速: ~40% 快于顺序执行
```

---

## 任务详情

### T1: 后端项目初始化

**描述**: 创建 Node.js + Express + PostgreSQL 后端项目骨架

**创建文件**:
```
server/
├── package.json
├── .env.example
├── .gitignore
├── jest.config.js
├── src/
│   ├── app.js                    # Express 应用入口
│   ├── server.js                 # HTTP 服务器启动
│   ├── config/
│   │   ├── database.js           # PostgreSQL 连接池配置
│   │   ├── environment.js        # 环境变量加载
│   │   └── cors.js               # CORS 配置
│   ├── middleware/
│   │   ├── auth.js               # JWT 认证中间件
│   │   ├── errorHandler.js       # 全局错误处理
│   │   ├── validator.js          # 请求验证中间件
│   │   └── logger.js             # 请求日志中间件
│   └── utils/
│       ├── response.js           # 统一响应格式
│       └── errors.js             # 自定义错误类
├── tests/
│   └── setup.js                  # 测试环境配置
└── docs/
    └── API.md                    # API 文档（中文）
```

**依赖安装**:
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "pg": "^8.11.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.3.0",
    "express-validator": "^7.0.0",
    "helmet": "^7.0.0",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.0",
    "nodemon": "^3.0.0"
  }
}
```

**验收标准**:
- [ ] `npm install` 成功
- [ ] `npm start` 启动 Express 服务器
- [ ] `GET /health` 返回 200
- [ ] 数据库连接测试通过

**分类建议**: `quick` — 项目脚手架，单次操作
**技能评估**: 无需特殊技能

---

### T2: 数据库 Schema 设计

**描述**: 设计 PostgreSQL 数据库 Schema，从 SQLite 3张表扩展为规范化设计

**创建文件**:
```
server/
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_exhibitions.sql
│   ├── 003_create_registrations.sql
│   ├── 004_create_refresh_tokens.sql
│   └── 005_create_indexes.sql
├── seeds/
│   └── 001_demo_data.sql
└── src/
    └── config/
        └── migrate.js              # 数据库迁移脚本
```

**Schema 设计**:

```sql
-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',  -- user, exhibitor, admin
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, banned, restricted
    avatar_url TEXT,
    bio TEXT,
    contact_info TEXT,
    social_media TEXT,
    show_exhibitions VARCHAR(20) DEFAULT 'private',  -- public, private, exhibitors_only
    registration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_time TIMESTAMP
);

-- 展会表
CREATE TABLE exhibitions (
    id SERIAL PRIMARY KEY,
    creator_id INTEGER REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    venue VARCHAR(200) NOT NULL,
    day INTEGER NOT NULL,
    time VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',  -- open, closed, ended, locked
    description TEXT DEFAULT '',
    category VARCHAR(50) DEFAULT '',
    registration_mode VARCHAR(20) DEFAULT 'open',  -- open, approval, display_only
    max_custom_fields INTEGER DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 报名表
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    exhibition_id INTEGER REFERENCES exhibitions(id),
    user_id INTEGER REFERENCES users(id),
    visitor_name VARCHAR(100) NOT NULL,
    visitor_type VARCHAR(50) NOT NULL,
    needs_summary TEXT DEFAULT '',
    custom_fields JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(exhibition_id, user_id)
);

-- 刷新令牌表
CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE
);

-- 索引
CREATE INDEX idx_exhibitions_creator ON exhibitions(creator_id);
CREATE INDEX idx_exhibitions_status ON exhibitions(status);
CREATE INDEX idx_exhibitions_day ON exhibitions(day);
CREATE INDEX idx_registrations_exhibition ON registrations(exhibition_id);
CREATE INDEX idx_registrations_user ON registrations(user_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

**验收标准**:
- [ ] 迁移脚本可重复执行
- [ ] 种子数据包含3个演示用户
- [ ] 外键约束正确

**分类建议**: `quick` — SQL 脚本编写
**技能评估**: 无需特殊技能

---

### T3: 后端认证模块 (JWT)

**描述**: 实现 JWT + Refresh Token 认证系统

**创建文件**:
```
server/src/
├── features/
│   └── auth/
│       ├── auth.routes.js         # POST /auth/register, /auth/login, /auth/logout, /auth/refresh
│       ├── auth.controller.js     # 请求处理
│       ├── auth.service.js        # 业务逻辑
│       ├── auth.repository.js     # 数据库操作
│       └── auth.validator.js      # 输入验证规则
```

**API 端点**:
```
POST /api/v1/auth/register    # 注册
POST /api/v1/auth/login       # 登录，返回 accessToken + refreshToken
POST /api/v1/auth/logout      # 登出，撤销 refreshToken
POST /api/v1/auth/refresh     # 刷新 accessToken
GET  /api/v1/auth/me          # 获取当前用户信息
```

**认证流程**:
1. 登录 → 服务器返回 accessToken (15分钟) + refreshToken (7天)
2. API 调用 → Authorization: Bearer <accessToken>
3. accessToken 过期 → 401 → 客户端用 refreshToken 请求新 accessToken
4. refreshToken 过期 → 401 → 客户端重新登录

**验收标准**:
- [ ] 注册返回用户对象
- [ ] 登录返回 token 对
- [ ] 无效密码返回 401
- [ ] refreshToken 可刷新 accessToken
- [ ] 登出撤销 refreshToken

**TDD 测试**:
```javascript
// tests/auth.test.js
describe('POST /api/v1/auth/register', () => {
  it('应该成功注册新用户');
  it('应该拒绝重复用户名');
  it('应该拒绝弱密码');
});

describe('POST /api/v1/auth/login', () => {
  it('应该返回 accessToken 和 refreshToken');
  it('应该拒绝错误密码');
  it('应该拒绝不存在的用户');
});
```

**分类建议**: `deep` — 认证逻辑复杂，涉及安全
**技能评估**: 无需特殊技能

---

### T4: 后端展会 API

**描述**: 实现展会 CRUD + 搜索 + 分页

**创建文件**:
```
server/src/
├── features/
│   └── exhibitions/
│       ├── exhibitions.routes.js
│       ├── exhibitions.controller.js
│       ├── exhibitions.service.js
│       ├── exhibitions.repository.js
│       └── exhibitions.validator.js
```

**API 端点**:
```
GET    /api/v1/exhibitions           # 列表（分页、筛选、搜索）
POST   /api/v1/exhibitions           # 创建（需认证，展商/管理员）
GET    /api/v1/exhibitions/:id       # 详情
PUT    /api/v1/exhibitions/:id       # 更新（需认证，创建者/管理员）
DELETE /api/v1/exhibitions/:id       # 删除（需认证，创建者/管理员）
PATCH  /api/v1/exhibitions/:id/status # 更新状态（需认证）
```

**验收标准**:
- [ ] 列表支持分页 (page, limit)
- [ ] 列表支持状态筛选
- [ ] 列表支持搜索 (query)
- [ ] 创建需要认证
- [ ] 非创建者不能更新/删除
- [ ] 管理员可以锁定展会

**分类建议**: `deep` — CRUD + 权限逻辑
**技能评估**: 无需特殊技能

---

### T5: 后端报名 API

**描述**: 实现报名提交 + 审批 + 取消

**创建文件**:
```
server/src/
├── features/
│   └── registrations/
│       ├── registrations.routes.js
│       ├── registrations.controller.js
│       ├── registrations.service.js
│       ├── registrations.repository.js
│       └── registrations.validator.js
```

**API 端点**:
```
GET    /api/v1/registrations                    # 我的报名列表
POST   /api/v1/registrations                    # 提交报名
PATCH  /api/v1/registrations/:id/cancel         # 取消报名
GET    /api/v1/exhibitions/:id/registrations    # 展会的报名列表（需认证，展商/管理员）
PATCH  /api/v1/registrations/:id/approve        # 批准报名（需认证，展商/管理员）
PATCH  /api/v1/registrations/:id/reject         # 拒绝报名（需认证，展商/管理员）
```

**验收标准**:
- [ ] 用户不能重复报名同一展会
- [ ] 展会状态为 closed 时不能报名
- [ ] 只有展商/管理员可以审批
- [ ] 取消只能取消自己的报名

**分类建议**: `deep` — 状态机 + 权限
**技能评估**: 无需特殊技能

---

### T6: 后端用户 API

**描述**: 实现用户管理 + 个人资料

**创建文件**:
```
server/src/
├── features/
│   └── users/
│       ├── users.routes.js
│       ├── users.controller.js
│       ├── users.service.js
│       ├── users.repository.js
│       └── users.validator.js
```

**API 端点**:
```
GET    /api/v1/users                  # 用户列表（管理员）
GET    /api/v1/users/:id              # 用户公开资料
PUT    /api/v1/users/:id              # 更新个人资料
PATCH  /api/v1/users/:id/status       # 更新用户状态（管理员）
GET    /api/v1/users/:id/exhibitions  # 用户参加的展会
```

**验收标准**:
- [ ] 个人资料更新需要认证
- [ ] 用户状态管理需要管理员权限
- [ ] 公开资料根据隐私设置返回

**分类建议**: `quick` — 标准 CRUD
**技能评估**: 无需特殊技能

---

### T7: 后端测试

**描述**: 为所有 API 端点编写测试

**创建文件**:
```
server/tests/
├── auth.test.js
├── exhibitions.test.js
├── registrations.test.js
├── users.test.js
└── helpers/
    └── testUtils.js                # 测试工具函数
```

**验收标准**:
- [ ] 所有端点有正向和反向测试
- [ ] 权限测试覆盖所有角色组合
- [ ] 边界条件测试（空值、超长、特殊字符）
- [ ] 测试覆盖率 > 80%

**分类建议**: `deep` — 全面测试覆盖
**技能评估**: 无需特殊技能

---

### T8: Android 网络层基础

**描述**: 添加 Retrofit + OkHttp 依赖，创建网络基础设施

**修改文件**:
- `app/build.gradle` — 添加依赖

**创建文件**:
```
app/src/main/java/com/example/calmobile/
├── network/
│   ├── ApiClient.java              # Retrofit 单例配置
│   ├── ApiService.java             # 所有 API 端点接口定义
│   ├── AuthInterceptor.java        # 自动添加 JWT token
│   ├── TokenAuthenticator.java     # 401 时自动刷新 token
│   └── NetworkConfig.java          # API base URL 配置
├── model/
│   ├── dto/                        # 数据传输对象
│   │   ├── LoginRequest.java
│   │   ├── LoginResponse.java
│   │   ├── RegisterRequest.java
│   │   ├── ExhibitionDto.java
│   │   ├── RegistrationDto.java
│   │   └── UserDto.java
│   └── api/                        # API 响应包装
│       ├── ApiResponse.java
│       └── PaginatedResponse.java
```

**新增依赖** (app/build.gradle):
```groovy
dependencies {
    // 网络层
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'com.squareup.okhttp3:logging-interceptor:4.12.0'

    // 生命周期
    implementation 'androidx.lifecycle:lifecycle-viewmodel:2.7.0'
    implementation 'androidx.lifecycle:lifecycle-livedata:2.7.0'

    // 测试
    testImplementation 'com.squareup.okhttp3:mockwebserver:4.12.0'
    testImplementation 'org.mockito:mockito-core:5.8.0'
}
```

**验收标准**:
- [ ] Retrofit 单例正确初始化
- [ ] AuthInterceptor 自动添加 token
- [ ] TokenAuthenticator 处理 401 刷新
- [ ] MockWebServer 测试通过

**TDD 测试**:
```java
// ApiClientTest.java
@Test
public void should_addAuthorizationHeader_when_tokenExists() { }
@Test
public void should_refreshToken_when_receive401() { }
@Test
public void should_retryOriginalRequest_when_tokenRefreshed() { }
```

**分类建议**: `unspecified-high` — 基础设施搭建
**技能评估**: 无需特殊技能

---

### T9: Android Repository 层

**描述**: 创建 Repository 模式，封装数据源选择逻辑

**创建文件**:
```
app/src/main/java/com/example/calmobile/
├── repository/
│   ├── ExhibitionRepository.java   # 展会数据源（API + 本地缓存）
│   ├── RegistrationRepository.java # 报名数据源
│   ├── UserRepository.java         # 用户数据源
│   ├── AuthRepository.java         # 认证数据源
│   └── BaseRepository.java         # 通用错误处理
├── local/
│   ├── ExhibitionDao.java          # 本地展会数据访问
│   ├── RegistrationDao.java        # 本地报名数据访问
│   └── UserDao.java                # 本地用户数据访问
```

**Repository 模式**:
```java
public class ExhibitionRepository {
    private final ApiService apiService;
    private final ExhibitionDao localDao;

    // 优先从 API 获取，失败时回退到本地缓存
    public LiveData<List<Exhibition>> getExhibitions() {
        // 1. 先返回本地缓存
        // 2. 同时请求 API
        // 3. API 成功 → 更新本地缓存 → 触发 LiveData 更新
        // 4. API 失败 → 保留本地缓存，显示离线提示
    }
}
```

**验收标准**:
- [ ] Repository 封装 API 和本地数据源
- [ ] 离线时回退到本地缓存
- [ ] 在线时优先使用 API 数据
- [ ] 错误处理统一

**TDD 测试**:
```java
// ExhibitionRepositoryTest.java
@Test
public void should_returnApiData_when_networkAvailable() { }
@Test
public void should_returnLocalData_when_networkUnavailable() { }
@Test
public void should_updateLocalCache_when_apiSuccess() { }
```

**分类建议**: `deep` — 数据源协调逻辑
**技能评估**: 无需特殊技能

---

### T10: Android ViewModel 层

**描述**: 为每个主要功能创建 ViewModel，实现 MVVM 模式

**创建文件**:
```
app/src/main/java/com/example/calmobile/
├── viewmodel/
│   ├── AuthViewModel.java          # 登录/注册/登出
│   ├── ExhibitionViewModel.java    # 展会列表/详情/CRUD
│   ├── RegistrationViewModel.java  # 报名管理
│   ├── ProfileViewModel.java       # 个人资料
│   └── AdminViewModel.java         # 管理员功能
```

**ViewModel 示例**:
```java
public class ExhibitionViewModel extends ViewModel {
    private final ExhibitionRepository repository;
    private final MutableLiveData<List<Exhibition>> exhibitions = new MutableLiveData<>();
    private final MutableLiveData<Boolean> loading = new MutableLiveData<>();
    private final MutableLiveData<String> error = new MutableLiveData<>();

    public void loadExhibitions() {
        loading.setValue(true);
        repository.getExhibitions().observeForever(result -> {
            loading.setValue(false);
            if (result.isSuccess()) {
                exhibitions.setValue(result.getData());
            } else {
                error.setValue(result.getError());
            }
        });
    }
}
```

**验收标准**:
- [ ] ViewModel 不持有 Activity 引用
- [ ] 数据通过 LiveData 观察
- [ ] 错误处理统一
- [ ] 加载状态可追踪

**分类建议**: `unspecified-high` — 架构层搭建
**技能评估**: 无需特殊技能

---

### T11: MainActivity 拆分

**描述**: 将 1962 行的 MainActivity 拆分为 Fragment + ViewModel 架构

**修改文件**:
- `MainActivity.java` — 重构为 Fragment 容器

**创建文件**:
```
app/src/main/java/com/example/calmobile/
├── fragment/
│   ├── HomeFragment.java           # 首页标签
│   ├── ProfileFragment.java        # 个人标签
│   ├── ExhibitorFragment.java      # 展商标签
│   └── AdminFragment.java          # 管理标签
├── adapter/
│   ├── ExhibitionAdapter.java      # 展会列表适配器
│   ├── RegistrationAdapter.java    # 报名列表适配器
│   └── UserAdapter.java            # 用户列表适配器
```

**创建布局文件**:
```
app/src/main/res/layout/
├── fragment_home.xml
├── fragment_profile.xml
├── fragment_exhibitor.xml
├── fragment_admin.xml
├── item_exhibition.xml
├── item_registration.xml
└── item_user.xml
```

**拆分策略**:
1. 提取 `buildTabHome()` → `HomeFragment`
2. 提取 `buildTabProfile()` → `ProfileFragment`
3. 提取 `buildTabExhibitor()` → `ExhibitorFragment`
4. 提取 `buildTabAdmin()` → `AdminFragment`
5. 每个 Fragment 绑定对应的 ViewModel
6. 使用 RecyclerView 替代手动构建的列表

**验收标准**:
- [ ] MainActivity < 200 行
- [ ] 每个 Fragment < 300 行
- [ ] 标签切换保持状态
- [ ] UI 外观不变

**分类建议**: `deep` — 大规模重构
**技能评估**: 无需特殊技能

---

### T12: Android 认证集成

**描述**: 将 AuthManager 从内存存储迁移到 API 认证

**修改文件**:
- `AuthManager.java` — 改为使用 AuthRepository
- `LoginActivity.java` — 使用 AuthViewModel
- `RegisterActivity.java` — 使用 AuthViewModel

**创建文件**:
```
app/src/main/java/com/example/calmobile/
├── storage/
│   └── TokenManager.java           # 安全存储 JWT tokens (SharedPreferences 加密)
```

**迁移策略**:
1. AuthManager 改为代理模式，内部调用 AuthRepository
2. TokenManager 使用 EncryptedSharedPreferences 存储 tokens
3. 登录流程: LoginActivity → AuthViewModel → AuthRepository → ApiService
4. 保持旧接口兼容，逐步替换调用方

**验收标准**:
- [ ] 登录成功后 token 安全存储
- [ ] 应用重启后自动登录
- [ ] token 过期自动刷新
- [ ] 登出清除 tokens

**TDD 测试**:
```java
// AuthManagerTest.java
@Test
public void should_storeTokenSecurely_when_loginSuccess() { }
@Test
public void should_autoLogin_when_tokenValid() { }
@Test
public void should_refreshToken_when_accessTokenExpired() { }
```

**分类建议**: `deep` — 认证重构
**技能评估**: 无需特殊技能

---

### T13: Android 数据迁移

**描述**: 将 ExhibitionManager、RegistrationManager、AdminUserManager 从 SQLite 迁移到 API

**修改文件**:
- `ExhibitionManager.java` — 改为使用 ExhibitionRepository
- `RegistrationManager.java` — 改为使用 RegistrationRepository
- `AdminUserManager.java` — 改为使用 UserRepository
- `DatabaseHelper.java` — 保留作为本地缓存

**迁移策略 (Dual-Write → Sync → Cutover)**:

**阶段 1: Dual-Write (双写)**
- 所有写操作同时写入 API 和本地 SQLite
- 读操作优先从 API 获取，失败时回退到本地
- 保持数据一致性

**阶段 2: Sync (同步)**
- 添加后台同步服务
- 定期将本地未同步数据推送到服务器
- 处理冲突（服务器优先）

**阶段 3: Cutover (切换)**
- 移除本地写入逻辑
- 本地 SQLite 仅作为只读缓存
- 完全依赖 API

**验收标准**:
- [ ] 现有数据可迁移到服务器
- [ ] 离线模式下可正常使用（只读）
- [ ] 在线时数据自动同步
- [ ] 冲突正确解决

**分类建议**: `deep` — 数据迁移复杂
**技能评估**: 无需特殊技能

---

### T14: 中文注释统一

**描述**: 将所有 Java 文件的注释统一为中文，遵循现有 ARCHITECTURE.md 的风格

**修改文件**: 所有 27 个 Java 源文件

**注释规范**:
```java
/**
 * 展会管理器
 *
 * 负责展会的增删改查操作，支持 SQLite 和内存双存储模式。
 * 当数据库不可用时自动回退到内存存储。
 *
 * @author CalMobile
 * @since 0.1.0
 */
public class ExhibitionManager {

    /**
     * 获取所有展会列表
     *
     * 优先从数据库获取，数据库不可用时从内存获取。
     *
     * @return 展会列表，不会返回 null
     */
    public static List<ExhibitorExhibition> listAll() {
        // ...
    }
}
```

**注释要求**:
- 类级 Javadoc: 描述职责、使用方式
- 方法级 Javadoc: 描述功能、参数、返回值
- 行内注释: 解释为什么，而不是做什么
- 常量注释: 说明用途和取值范围
- 所有注释使用中文

**验收标准**:
- [ ] 所有 public 方法有 Javadoc
- [ ] 所有类有类级 Javadoc
- [ ] 复杂逻辑有行内注释
- [ ] 无英文注释残留

**分类建议**: `writing` — 文档/注释工作
**技能评估**: 无需特殊技能

---

### T15: 中文文档编写

**描述**: 编写完整的中文项目文档

**创建/修改文件**:
```
docs/
├── API.md                          # API 接口文档（中文）
├── DEPLOYMENT.md                   # 部署指南（中文）
├── DEVELOPMENT.md                  # 开发指南（中文）
├── ARCHITECTURE.md                 # 更新架构文档（中文）
├── DATABASE.md                     # 数据库设计文档（中文）
├── MIGRATION.md                    # 迁移指南（中文）
└── CHANGELOG.md                    # 变更日志（中文）
server/
├── README.md                       # 后端说明（中文）
└── docs/
    └── API.md                      # API 详细文档（中文）
```

**文档内容**:
- **API.md**: 所有端点、请求/响应格式、错误码
- **DEPLOYMENT.md**: Docker 部署、环境变量、数据库初始化
- **DEVELOPMENT.md**: 开发环境搭建、代码规范、测试流程
- **ARCHITECTURE.md**: 更新为前后端分离架构图
- **DATABASE.md**: ER 图、表结构、索引设计
- **MIGRATION.md**: 从旧版迁移步骤

**验收标准**:
- [ ] 所有文档使用中文
- [ ] API 文档包含所有端点
- [ ] 部署指南可操作
- [ ] 架构图清晰

**分类建议**: `writing` — 文档编写
**技能评估**: 无需特殊技能

---

### T16: 集成测试

**描述**: 前后端集成测试，确保端到端流程正确

**创建文件**:
```
server/tests/
├── integration/
│   ├── auth.integration.test.js
│   ├── exhibition.integration.test.js
│   └── registration.integration.test.js

app/src/androidTest/java/com/example/calmobile/
├── ApiIntegrationTest.java
├── AuthFlowTest.java
└── ExhibitionFlowTest.java
```

**测试场景**:
1. 注册 → 登录 → 获取展会列表 → 报名 → 查看我的报名
2. 登录 → 创建展会 → 查看报名列表 → 审批报名
3. 管理员登录 → 管理用户 → 管理展会

**验收标准**:
- [ ] 端到端流程测试通过
- [ ] 错误场景覆盖
- [ ] 性能基准测试

**分类建议**: `deep` — 集成测试
**技能评估**: 无需特殊技能

---

## 原子提交策略

### 提交粒度原则
- 每个提交应该是独立可编译、可测试的
- 一个提交 = 一个逻辑变更
- 提交信息使用中文，遵循 conventional commit 格式

### 提交计划

**Wave 1 提交**:
```
feat(server): 初始化 Node.js + Express 后端项目
feat(server): 添加 PostgreSQL 数据库 Schema 和迁移脚本
feat(android): 添加 Retrofit + OkHttp 网络层依赖
refactor(android): 统一 Java 文件中文注释
```

**Wave 2 提交**:
```
feat(server): 实现 JWT 认证模块（注册、登录、登出、刷新）
feat(android): 创建 Repository 层数据源抽象
```

**Wave 3 提交**:
```
feat(server): 实现展会 CRUD API
feat(server): 实现报名管理 API
feat(server): 实现用户管理 API
feat(android): 创建 ViewModel 层
```

**Wave 4 提交**:
```
test(server): 添加认证模块单元测试
test(server): 添加展会模块单元测试
test(server): 添加报名模块单元测试
refactor(android): 拆分 MainActivity 为 Fragment 架构
feat(android): 集成 JWT 认证
feat(android): 连接后端 API 数据源
```

**Wave 5 提交**:
```
docs: 编写 API 接口文档
docs: 编写部署指南
docs: 更新架构文档
test: 添加前后端集成测试
```

---

## 风险缓解策略

### 风险 1: MainActivity 拆分导致 UI 回归
**缓解**: 
- 先写 UI 回归测试（截图对比）
- 逐个标签页拆分，每次拆分后验证
- 保持旧代码作为参考

### 风险 2: 数据迁移丢失
**缓解**:
- 实现 Dual-Write 阶段，确保数据不丢失
- 迁移前备份 SQLite 数据库
- 提供数据导出功能作为兜底

### 风险 3: 离线模式功能缺失
**缓解**:
- Repository 层实现离线回退
- 本地 SQLite 保留只读缓存
- 显示明确的网络状态提示

### 风险 4: JWT token 安全问题
**缓解**:
- 使用 EncryptedSharedPreferences
- refreshToken 设置合理过期时间
- 实现 token 轮转机制

### 风险 5: 后端 API 设计不合理
**缓解**:
- 先设计 API 文档，评审后再实现
- 版本化 API (v1)
- 保持向后兼容

---

## 总预估工作量

| 阶段 | 任务 | 预估时间 |
|------|------|----------|
| Wave 1 | 后端初始化 + Schema + Android网络层 + 注释统一 | 2-3 天 |
| Wave 2 | 后端认证 + Android Repository | 2-3 天 |
| Wave 3 | 后端 API + Android ViewModel | 3-4 天 |
| Wave 4 | 测试 + MainActivity拆分 + 认证集成 + 数据迁移 | 4-5 天 |
| Wave 5 | 文档 + 集成测试 | 2-3 天 |
| **总计** | | **13-18 天** |

---

## 执行顺序建议

1. **首先**: T1 + T2 + T8 + T14 (并行，建立基础)
2. **然后**: T3 + T9 (认证是核心)
3. **接着**: T4 + T5 + T6 + T10 (API 和 ViewModel)
4. **之后**: T11 + T12 + T13 (客户端重构)
5. **最后**: T7 + T15 + T16 (测试和文档)
