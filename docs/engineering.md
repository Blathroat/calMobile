# 工程边界与结构

本文件给要了解系统怎么搭的人看：分层边界、页面怎么交付、数据与设备能力从哪走、界面规则的通用约束。细节按任务去对应文件：

| 想知道 | 读 |
| --- | --- |
| 用户看到的行为 | [`product.md`](product.md) |
| 改一个页面 / 服务 / 样式时的文件级规则 | [`agents/implementation.md`](agents/implementation.md) |
| 构建、验证、发布与服务器更新 | [`operations.md`](operations.md) |
| 后端骨架、接口约定与数据模型 | [`server.md`](server.md) |

## 系统边界

| 层 | 责任 | 权威入口 |
| --- | --- | --- |
| WebView 页面 | 路由、渲染、表单和用户交互 | `web/src/`（构建到 `web/dist`） |
| 前端数据 | 类型化 REST client、令牌续期 | `web/src/api/client.ts`；契约表 `web/api-endpoints.mjs` |
| 前端加载 | 缓存首屏、后台刷新、错误呈现 | 页面 composable 与 `web/src/services/query-cache.ts` |
| 设备能力 | 原生：系统日历、通知权限、摄像头、媒体、分享、CSV、设备镜像；浏览器：文件选择、下载、Web Share、通知权限 | `web/src/services/device-services.ts`（原生动作表 `WebAppActions.handle()`，浏览器实现 `web/src/services/browser-device.ts`） |
| 后端 | 认证、业务规则、持久化、邮件和接口 | `server/` |

- 业务数据只存在服务端 PostgreSQL，前端经 `web/src/api/client.ts` 访问；页面不直接 `fetch`，也不通过原生桥取业务数据。
- 原生只做设备能力。没有原生桥时设备能力走浏览器实现，页面不按环境写两套。
- 后端不可用时页面给出可见错误；没有离线业务数据层。
- 读取接口直接返回数据，写接口返回 `{ ok, error, ... }` 信封。响应约定与错误分类见 [`server.md`](server.md)。
- 角色与账号状态由服务端判定；页面按后端下发的 `role` / `capabilities` 渲染入口，不自己推算权限。

## 页面交付与热更新

同一份 `web/dist` 同时服务 Android WebView 与 iPhone 主屏幕应用（PWA），站点上都在 `/app/`。

- 正式包打开 `APP_API_BASE` 所在源的 `/app/index.html`，WebView 拦截 `/app/` 读本机快照；没有快照或快照不是当前 `versionCode` 时读 APK 内那份。Safari 与主屏幕应用直接加载线上产物。
- 首屏之后后台拉取 `/app/release.json`，新文件留到下次冷启动换上，使用中不重载；调试包（接口是 http）不热更新。
- 只有 `/app/index.html` 能调用 `CalMobileNative`，其它链接交给系统浏览器。
- 设备上选中、尚未上传的媒体从 `https://appassets.androidplatform.net/media/` 读取，该响应带页面文档源可用的 `Access-Control-Allow-Origin`。
- PWA 的 Manifest、Service Worker 与安装图标在构建时生成；`release.json` 只服务 Android 热更新，不进 Service Worker 缓存。

## PWA、报名站与多实例

- 报名站是第二份构建：`web/join.html` 经 `web/vite.join.config.ts` 输出到 `web/dist-join`，由后端托管，不进 APK。应用用 hash 路由，报名站用 history 路由。
- 报名站不是可安装应用：不生成 manifest 与 Service Worker，也不拷安装图标。
- 页面包不写域名：接口与媒体一律用相对路径 `/api/v1`、`/media/...`，同一份产物可放到任意 `PUBLIC_BASE_URL` 下。`APP_API_BASE` 只用于 APK 外壳和开发代理，不注入页面；`web/check-page-bundle.mjs` 在产物里发现实例地址就让构建失败。
- 服务器启动时可读运行时品牌（`/etc/calmobile.env` 的 `PWA_*` / `APP_TITLE` / `JOIN_TITLE` / `APP_ICON*` 等）生成实例页面层，不改 `web/dist`。同一份运行时包可服务多个实例，每个实例只改自己的 env；APK 仍按实例构建。
- 站点 favicon、PWA 图标与 Android 启动图标共用 `scripts/build-icons.mjs` 一份源图（`APP_ICON`）。

## 数据加载与缓存

- 页面取数走 feature composable：先画出缓存内容，再后台刷新；失败保持可见，过期响应丢弃。写接口成功后按前缀失效读缓存。
- 查询缓存集中在 `web/src/services/query-cache.ts`，缓存键包含稳定序列化后的参数并对相同请求去重；底部导航按下时预取目标页。月视图一次取整月，点日期在本地完成。
- 凭据类与随时变化的读接口直连、不进缓存：报名查询链接（`registrations.queryByToken`）、用户协议正文、最近日志。
- 接口响应带 `Cache-Control: no-store`，前端请求也用 `cache: no-store`。具体键名、失效前缀与增强查询见 [`agents/implementation.md`](agents/implementation.md)。

## 原生桥职责

- 原生只处理设备能力：系统日历、通知权限、摄像头、图片选择与媒体落盘、文本分享、CSV 导出、文件选择与文本读写、保存图片、会话刷新令牌与可信设备凭据、通行密钥、退出应用。
- 页面统一从 `web/src/services/device-services.ts` 进：有桥走 `nativeBridge.call`，没有桥走浏览器实现，两边返回同一种结果形状。
- 通行密钥在应用内由系统凭据提供方完成，在浏览器里由 WebAuthn 完成；服务端校验同一套标准 WebAuthn JSON。

### 能力协商

- 页面可以比 APK 新：原生动作按 `app.capabilities` 协商，壳不认识的动作用 `unsupported` 失败并自动改走浏览器实现。
- 新增原生动作要同时更新 `ShellCapabilities` 清单与 `WebAppActions.handle` 的 switch。

## 界面与文案

- 页面只往外壳内容区放内容：不自建 `.page` / `.topbar` / `.app-body` / `.tabbar`，不写颜色、字号、间距与圆角，用 `web/src/styles/tokens.css` 的令牌。
- 固定遮罩与悬浮按钮 `Teleport` 到 `body`，否则路由容器的 transform 会成为 `position: fixed` 的包含块。
- 触控命中区至少 44px；动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。
- 状态同时用文字和颜色表达；空、加载、错误、成功、禁用状态在原位置给出下一步。
- 协议值（状态、报名方式、收集项类型、角色）一律用英文 code，界面按 code 查文案，不能用中文标签字段做比较或回传。
- 界面文案写在 `web/src/i18n/zh.json`，用 `t('auth.login.title')` 点分路径读取；带变量的整句写成一条。用户语言包在本机，不随页面更新；邮件正文在后端。
- 状态与身份标签、输入框、日期时间选择、抽屉、图标等组件的既有约定，改代码前读 [`agents/implementation.md`](agents/implementation.md) 的「界面组件与页面约定」。
