# 技术选型文档

## 概述

本文档记录展会排期助手项目的技术选型决策和理由。

## 技术栈

### Android 客户端

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **Java** | 11 | 主要开发语言 | 项目现有代码为 Java，避免大规模重写 |
| **Retrofit** | 2.9.0 | 网络请求 | Android 最成熟的网络库，类型安全，易于测试 |
| **OkHttp** | 4.12.0 | HTTP 客户端 | Retrofit 底层依赖，支持拦截器、日志等 |
| **Room** | 2.6.1 | 本地数据库 | Android 官方推荐，编译时验证，与 LiveData 无缝集成 |
| **LiveData** | 2.7.0 | 响应式数据 | 生命周期感知，避免内存泄漏 |
| **ViewModel** | 2.7.0 | UI 状态管理 | 与 LiveData 配合，管理 UI 状态 |
| **Gson** | 2.10.1 | JSON 解析 | 简单易用，与 Retrofit 无缝集成 |
| **Glide** | 4.16.0 | 图片加载 | 高效的图片加载和缓存 |
| **Material Design** | 1.11.0 | UI 组件 | 官方设计规范，丰富的组件库 |

### 后端服务器

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **Node.js** | 18+ | 运行时 | 异步 I/O，适合高并发 API 服务 |
| **Express** | 4.18.2 | Web 框架 | 简单灵活，生态丰富 |
| **PostgreSQL** | 15+ | 数据库 | 功能强大，支持复杂查询和事务 |
| **JWT** | - | 认证 | 无状态认证，适合分布式系统 |
| **bcryptjs** | - | 密码加密 | 安全的密码哈希算法 |

## 架构模式

### Android 客户端

采用 **MVVM + Repository** 模式：

```
┌─────────────────────────────────────────────┐
│                  UI Layer                   │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Activity   │  │    ViewModel        │  │
│  │  (View)     │→ │    (LiveData)       │  │
│  └─────────────┘  └──────────┬──────────┘  │
│                              │             │
│                  ┌───────────┴──────────┐  │
│                  │     Repository       │  │
│                  └───────────┬──────────┘  │
│                              │             │
│            ┌─────────────────┼───────────┐ │
│            │                 │           │ │
│   ┌────────┴──────┐  ┌──────┴───────┐   │ │
│   │  Local (Room) │  │ Remote (API) │   │ │
│   │  SQLite Cache │  │   Retrofit   │   │ │
│   └───────────────┘  └──────────────┘   │ │
└─────────────────────────────────────────────┘
```

**层级说明：**
- **UI Layer**: Activity/Fragment 负责显示，ViewModel 管理状态
- **Repository**: 数据仓库，协调本地和远程数据源
- **Local**: Room 数据库，提供离线缓存
- **Remote**: Retrofit API 调用，与后端服务器通信

### 后端服务器

采用 **RESTful API** 架构：

```
┌─────────────────────────────────────────────┐
│              Express Server                 │
│  ┌──────────────────────────────────────┐  │
│  │           Middleware                 │  │
│  │  (CORS, Auth, Validation, Logging)   │  │
│  └──────────────────┬───────────────────┘  │
│                     │                      │
│  ┌──────────────────┴───────────────────┐  │
│  │           Routes                     │  │
│  │  (/auth, /users, /exhibitions, ...)  │  │
│  └──────────────────┬───────────────────┘  │
│                     │                      │
│  ┌──────────────────┴───────────────────┐  │
│  │           Controllers                │  │
│  │        (Business Logic)              │  │
│  └──────────────────┬───────────────────┘  │
│                     │                      │
│  ┌──────────────────┴───────────────────┐  │
│  │           Models                     │  │
│  │      (Database Queries)              │  │
│  └──────────────────┬───────────────────┘  │
│                     │                      │
│  ┌──────────────────┴───────────────────┐  │
│  │         PostgreSQL                   │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 数据流

### 用户登录流程

```
用户输入 → LoginActivity → ViewModel.login()
    ↓
Repository.login()
    ↓
Retrofit API → POST /auth/login
    ↓
服务器验证 → 返回 JWT 令牌
    ↓
RetrofitClient.saveTokens()
    ↓
跳转到 MainActivity
```

### 展会列表加载流程

```
MainActivity.onCreate() → ViewModel.loadExhibitions()
    ↓
Repository.getExhibitions()
    ↓
Room DAO.getAllExhibitions() → 返回缓存数据
    ↓
同时：Repository.refreshExhibitions()
    ↓
Retrofit API → GET /exhibitions
    ↓
更新 Room 缓存 → LiveData 自动通知 UI
```

## 认证方案

### JWT 令牌

- **访问令牌 (Access Token)**: 有效期 15 分钟，用于 API 认证
- **刷新令牌 (Refresh Token)**: 有效期 7 天，用于获取新的访问令牌

### 令牌存储

- 使用 `EncryptedSharedPreferences` 安全存储令牌
- 自动附加到请求头：`Authorization: Bearer <token>`

### 令牌刷新

- 访问令牌过期时，自动使用刷新令牌获取新的访问令牌
- 刷新令牌过期时，要求用户重新登录

## 数据库设计

### PostgreSQL（后端）

| 表名 | 用途 | 主要字段 |
|------|------|----------|
| users | 用户表 | id, username, password_hash, email, nickname, role, status |
| exhibitions | 展会表 | id, title, venue, day, month, year, time, status, open_for_registration |
| registrations | 报名表 | id, exhibition_id, visitor_id, visitor_name, visitor_type, status |
| notifications | 通知表 | id, user_id, title, message, type, is_read |
| calendar_events | 日历事件表 | id, user_id, exhibition_id, event_id |

### Room（Android 客户端）

与 PostgreSQL 表结构对应，用于本地缓存：

| 表名 | 用途 |
|------|------|
| exhibitions | 展会缓存 |
| users | 用户缓存 |
| registrations | 报名缓存 |

## API 设计原则

1. **RESTful**: 使用标准 HTTP 方法（GET, POST, PUT, DELETE）
2. **资源导向**: API 路径基于资源（/users, /exhibitions, /registrations）
3. **统一响应格式**: 所有响应使用 `ApiResponse<T>` 包装
4. **版本控制**: API 路径包含版本号（/api/v1/）
5. **认证**: 使用 JWT Bearer Token 认证

## 安全考虑

1. **密码加密**: 使用 bcryptjs 加密存储密码
2. **JWT 令牌**: 使用 HMAC SHA256 签名
3. **HTTPS**: 生产环境强制使用 HTTPS
4. **输入验证**: 使用 express-validator 验证输入
5. **CORS**: 配置允许的源
6. **SQL 注入**: 使用参数化查询

## 部署方案

### 后端服务器

- **开发环境**: 本地运行 Node.js
- **生产环境**: Docker 容器化部署
- **数据库**: PostgreSQL 云服务或自托管

### Android 客户端

- **开发环境**: Android Studio 模拟器
- **测试环境**: 真机调试
- **发布**: Google Play Store

## 未来扩展

1. **推送通知**: Firebase Cloud Messaging
2. **实时通信**: WebSocket
3. **文件上传**: 支持图片和文档上传
4. **数据分析**: 用户行为分析
5. **多语言**: 国际化支持
