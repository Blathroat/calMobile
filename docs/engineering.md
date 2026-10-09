# 工程边界与界面实现

本文件是客户端、前后端边界和界面实现规则的来源。后端完整接口、数据模型和错误细节见 [`server/README.md`](../server/README.md)；视觉交付件见 [`newUI/`](newUI/)。

## 系统边界

业务数据只有一处来源：`server/` 的 PostgreSQL。前端不复制业务规则，原生不实现业务数据；后端不可用时页面明确报错，不做本地降级。

| 层 | 责任 | 权威入口 |
| --- | --- | --- |
| WebView 页面 | 路由、渲染、表单和用户交互 | `web/src/`（构建后同步到 generated assets） |
| 前端数据 | 类型化 REST client、令牌续期、缓存 | `web/src/api/client.ts`；契约表为 `web/api-endpoints.mjs` |
| 前端加载 | 缓存首屏、后台刷新、错误呈现 | Vue composable 与 `web/src/services/query-cache.ts` |
| 原生桥接 | 日历、通知权限、摄像头、媒体、分享、CSV、设备镜像 | `WebAppActions.handle()` 的固定动作表 |
| 后端 | 认证、业务规则、持久化、邮件和接口 | `server/src/` |

## 前端结构

```text
web/
├── index.html
├── src/app/                外壳、启动、路由、导航方向、外观（明暗与强调色）
├── src/api/                类型化领域 API
├── src/components/         共享界面件（图标、顶栏、底部导航、状态块、分段控件、二维码…）
├── src/composables/        页面取数 composable
├── src/services/           HTTP、缓存、校验、格式化、状态词汇、Markdown/清洗、原生桥接
├── src/stores/             Pinia 跨页面状态
├── src/pages/              Vue 页面（只提供内容，不搭外壳）
└── src/styles/             设计令牌与动效
```

页面不直接 `fetch`，也不通过原生桥接取业务数据。读取接口直接返回数据；写接口返回 `{ ok, error, ... }`。接口规则和前端动作必须在 `web/src/api/client.ts`、`web/api-endpoints.mjs`、后端路由、契约测试四处同时更新。

## 应用外壳

外壳在 `web/src/app/App.vue`：`.app` 网格 = 顶栏 + 可滚动的内容区 + 底部导航（或页面页脚）。页面只往内容区放内容。

- 顶栏标题、返回键、底部导航项与内容区密度都由路由 `meta` 决定（`title` / `back` / `tab` / `bodyGap` / `bodyPad` / `bodyAlign` / `queryInPlace`），导航项按角色过滤（`web/src/app/shell.ts`）。
- 页面级顶栏操作也写在 `meta.topAction`（`{ icon, to, label }`），外壳据此渲染右上角图标按钮（个人页的「设置」入口就是这么来的）。
- 页面需要固定操作区时用 `<Teleport defer to="#app-foot">` 投递 `.page-foot`，它落在网格第三行；`defer` 让目标元素与页面在同一次渲染里创建时也能找到。入口页（01）是例外：注册 / 忘记密码两个文字入口按旧版版式跟在表单后面随内容滚动，不占页脚槽。
- 页面不要自建 `.page` / `.topbar` / `.app-body` / `.tabbar`，也不要声明颜色、字号、间距与圆角。
- 内容区的左右内距由外壳给两道（`.app-body` 与路由容器 `.page-surface` 各 `var(--s4)`，合计 32px，与旧版实机一致），页面不要再自己加左右内距；确需通栏的页面用路由 `meta.bodyPad: 'none'`，两道一起去掉。
- 底部面板统一走 `web/src/services/sheet.ts`：一句话加按钮用 `title / message / actions`；带输入框或列表的用 `component` + `props`（面板组件只负责内容，关闭与动作仍由服务管，例如手动输入报名码与粘贴 Markdown）；选项多于两个时 `layout: 'stack'` 竖排。页面不再自建 `.sheet` 结构。
- 列表型页面的分区/筛选写进地址栏（`?tab=`），从二级页返回时才能回到同一分区。
- 切换方向由 `web/src/app/navigation.ts` 算出：二级页按路径深度写 `.app[data-direction]`（前进 / 后退 / 原地替换），底部导航之间按导航顺序写 `.app[data-tab-move]`，`motion.css` 据此选过渡；冷启动的第一次跳转按原地替换处理，首帧静态落地。
- 标签页之间的过渡是**只位移不淡入**的横向滑动：淡入期间新页面还是透明的，露出来的是外壳背景，浅色模式下就是「切标签页闪一下白」。同一屏只换 query（管理页的分区）时方向信号一个都不动，否则动画名会被换成淡入、同一个元素重放一次淡入。
- 页面自己 `watch` query 完成切换的（管理后台三个分区）在 `meta` 里声明 `queryInPlace: true`：外壳改用 `path` 作键，分区切换不重建页面；同时把那几个分区的读接口提前预热，切过去直接命中缓存。
- 明暗模式与管理员强调色在 `web/src/app/theme.ts` 落到 `<html data-mode>` 与 `--accent*`；首帧由 `index.html` 的内联脚本按本机缓存落一次，避免闪白。用户自己的明暗模式与强调色是**账号偏好**（`users.ui_mode` / `users.ui_theme`，经 `PUT /settings/ui-mode`、`PUT /settings/ui-theme` 保存），本机只缓存一份供首帧使用，切换走 `web/src/app/preferences.ts`（本地先生效、落库失败回滚）。`app_settings.theme` 只提供默认色板与全局默认下标。

## 屏幕对照

| 编号 | 页面模块 | 主要用途 |
| --- | --- | --- |
| 01 | `web/src/pages/LoginPage.vue` | 登录或访客入口 |
| 02 | `web/src/pages/HomePage.vue` | 月视图与当天展会 |
| 03 | `web/src/pages/DetailPage.vue` | 详情、报名、日历、分享 |
| 04 | `web/src/pages/RegistrationFormPage.vue` | 填写报名 |
| 05 | `web/src/pages/RegisterPage.vue` | 两步注册 |
| — | `web/src/pages/ForgotPasswordPage.vue` | 找回密码 |
| 06 | `web/src/pages/SearchPage.vue` | 搜索展会、地点和用户 |
| 07 | `web/src/pages/MyRegistrationsPage.vue` | 我的报名 |
| 08 | `web/src/pages/RegistrationDetailPage.vue` | 报名详情、报名码与撤销 |
| 09 | `web/src/pages/ProfilePage.vue` | 个人资料展示与设置卡片（隐私开关在设置页） |
| — | `web/src/pages/UserSettingsPage.vue` | 用户设置（头像、资料、通知、配色、明暗、隐私、安全入口），入口在个人页顶栏右侧与设置卡片 |
| 10 | `web/src/pages/ExhibitorPage.vue` | 展商后台 |
| 11 | `web/src/pages/ExhibitionFormPage.vue` | 展会编辑 |
| 12 | `web/src/pages/RichEditorPage.vue` | Markdown 简介与媒体 |
| 13 | `web/src/pages/ReviewPage.vue` | 报名审核 |
| 14 | `web/src/pages/UserPublicPage.vue` | 用户公开页 |
| 15 | `web/src/pages/AdminPage.vue` | 管理后台 |
| — | `web/src/pages/SecurityPage.vue` | 密码、邮箱、身份复核与两步验证 |
| — | `web/src/pages/SecurityDevicesPage.vue` | 查看并撤销已登录设备 |
| — | `web/src/pages/CheckinPage.vue` | 现场核销工具 |

设计稿的 16、17 屏已内联到管理后台与用户设置；核销属于展商后台入口，不新增二级页面。应用配色与明暗模式是**个人偏好**（用户在「用户设置」里自己选），管理后台只维护全局默认色板与品牌文案。新增页面时在 `web/src/app/router.ts` 注册路由，同时更新本表与 `web/src/app/shell.test.ts` 的 `ROUTES`（该用例逐屏挂载外壳并断言顶栏、内容区、底部导航与页脚槽）。

## 数据加载规则

- 查询 composable 负责加载、缓存首屏、后台刷新和错误块；不要用 `Promise.allSettled` 吞掉失败，也不要把未知状态显示成成功。
- 查询缓存集中在 `web/src/services/query-cache.ts`；缓存键包含稳定序列化后的参数，并对相同请求去重。月视图一次取整月，点日期在本地完成，不重复请求。
- 写接口的失效前缀必须与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`、`users` ↔ `users.record`），否则改完再读会命中旧值。
- 页面已有内容时刷新只标记忙碌，不清空旧内容；过期响应丢弃，避免慢请求覆盖新视图。

## 原生桥接

可信设备的随机凭据也由原生 `session.device` 生成并保存在设备私有目录；浏览器预览使用本机存储。

原生只处理以下设备能力：`ui.sync`、摄像头权限、系统日历、通知权限、图片选择与媒体落盘、文本分享、CSV 导出，以及会话刷新令牌与可信设备凭据的设备内存存储（`session.save` / `session.load` / `session.clear` / `session.device`，见 `SessionStore.java`）。`AppSettings` 是后端设置的设备镜像；日历用后端下发的 ISO 日期定位，失败必须回调失败。

媒体落在应用私有目录 `files/media`，前端只保存短 URL；资源路径只允许单层文件名。业务数据动作不加入原生动作表。

## 界面规则

- `docs/newUI/` 是视觉来源；生产样式集中在 `styles/tokens.css` 和 `styles/motion.css`，页面不重复写颜色、字号、间距或圆角。
- 触控命中区域至少 44px；状态同时使用文字与颜色或描边；空、加载、错误、成功和禁用状态在原位置给出下一步。
- 顶栏使用 `--topbar-h`；展会图保持 9:16；并排字段使用等高布局；日期、时间和状态使用选择器、分段控件或面板。
- 强调色使用 `--accent*`；二维码保持白底黑点；Markdown / HTML 渲染前经过 `web/src/services/markdown.ts`。
- 动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。动效全失时先检查设备 `animator_duration_scale`，再改代码。
- 第三方库由 `web/package.json` 与锁文件统一管理；重型功能通过动态导入按屏加载，构建产物随 APK 打包，不依赖运行时 CDN。Markdown 解析使用 Marked，历史 HTML 编辑转换使用 Turndown，HTML 清洗统一走 DOMPurify 与项目标签、属性和媒体协议规则。
- 二维码生成使用 qrcode-generator；识别使用 ZXing-C++ 的 `zxing-wasm/reader`，在 Worker 中串行解码。WASM 通过 Vite 资源导入定位到本地文件，Android 返回 `application/wasm`；暂停与换页后丢弃过期帧，离开时释放 Worker 和摄像头。

## 文案与资源

用户可见文案写入 `app/src/main/res/values/strings_frontend.xml`，前端用 `t('key')` 读取。源码变更后运行 `node scripts/extract-strings.js --write`，再运行 `node scripts/check-strings.js` 检查源码、资源和 `FrontendStrings.NAMES`。资源首尾不得有空白。脚本只替换 `.vue` 的 `<script>` 段与 `.ts` 里的普通字符串字面量（模板里的中文靠 `:placeholder="t('key')"` 这类绑定书写），并跳过测试文件与格式化常量模块。

## 设计来源

- `newUI/index.html` 和 `remaining-ui.html` 是流程线框源。
- `newUI/ui-spec.md` 是灰盒组件、表单、屏幕和交互规则。
- `newUI/DESIGN-HANDOFF.md` 是实现保真、响应式和可访问性合同。
- `newUI/DESIGN-MANIFEST.json` 是机器可读的屏幕和交互索引。

发生设计稿与实现冲突时，只把未决决策写入 [`docs/product.md`](product.md)；不要在多个文档重复解释同一条规则。
