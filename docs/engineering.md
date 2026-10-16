# 工程边界与界面实现

本文件是客户端、前后端边界和界面实现规则的来源。用户可见行为见 [`product.md`](product.md)。响应约定、服务端规则和数据模型见 [`server/README.md`](../server/README.md)。接口路径以各路由模块的注册表和 `web/api-endpoints.mjs` 为准。

颜色、字号、间距、圆角的取值在 `web/src/styles/tokens.css`，动效在 `web/src/styles/motion.css`。只被一个组件使用的样式写在该组件的 `<style>` 里，不加 `scoped`：选择器保持全局，不依赖父子组件的渲染边界。全局样式的导入顺序见 `web/src/main.ts`。

## 系统边界

业务数据只存在 `server/` 的 PostgreSQL。前端经 `web/src/api/client.ts` 访问。原生只做设备能力。后端不可用时页面报错。

| 层           | 责任                                              | 权威入口                                                  |
|--------------|---------------------------------------------------|-----------------------------------------------------------|
| WebView 页面 | 路由、渲染、表单和用户交互                        | `web/src/`（构建到 `web/dist`，包内一份，正式包再用本机快照） |
| 前端数据     | 类型化 REST client、令牌续期、缓存                | `web/src/api/client.ts`；契约表为 `web/api-endpoints.mjs` |
| 前端加载     | 缓存首屏、后台刷新、错误呈现                      | Vue composable 与 `web/src/services/query-cache.ts`       |
| 原生桥接     | 日历、通知权限、摄像头、媒体、分享、CSV、设备镜像 | `WebAppActions.handle()` 的固定动作表                     |
| 后端         | 认证、业务规则、持久化、邮件和接口                | `server/src/`                                             |

页面不直接 `fetch`，也不通过原生桥接取业务数据。读取接口直接返回数据。写接口按响应约定返回信封。

正式包的文档地址是 `APP_API_BASE` 所在源的 `/app/index.html`。WebView 拦截 `/app/`，从本机快照读文件；还没有快照，或快照不是当前 `versionCode` 时，用 APK 里的那份。页面切换不再请求网络。首屏出来之后才在后台拉取 `/app/release.json`，新文件留到下次冷启动再换上。调试包（接口是 http）不热更新。只有 `/app/index.html` 能调用 `CalMobileNative`，其它链接交给系统浏览器。设备上选中、尚未上传的媒体仍从 `https://appassets.androidplatform.net/media/` 读取。

新接口同时改 `web/src/api/client.ts`、`web/api-endpoints.mjs`、后端路由和 `server/src/test/` 下的契约测试。表单校验走 `web/src/services/validate.ts`，上限取 `useBootstrapStore().limits`。后端再校验一次。

## 应用外壳

外壳在 `web/src/app/App.vue`：`.app` 网格是顶栏、可滚动的内容区和底部导航（或页面页脚）。页面只往内容区放内容。

- 顶栏标题、返回键、底部导航项与内容区密度都由路由 `meta` 决定（`title` / `back` / `tab` / `bodyGap` / `bodyPad` / `bodyAlign` / `queryInPlace`）。导航项按角色过滤（`web/src/app/shell.ts`）。
- 页面级顶栏操作写在 `meta.topAction`（`{ icon, to, label }`，或 `{ icon, label, action: 'logout' }`）。外壳据此渲染右上角图标按钮。
- 固定操作区用 `<Teleport defer to="#app-foot">` 投递 `.page-foot`，落在网格第三行。`defer` 让目标元素与页面在同一次渲染里创建时也能找到。入口页是例外：注册和忘记密码两个文字入口跟在表单后面随内容滚动，不占页脚槽。
- 页面不自建 `.page` / `.topbar` / `.app-body` / `.tabbar`，也不写颜色、字号、间距与圆角。
- 内容区的左右内距由外壳给两道（`.app-body` 与路由容器 `.page-surface` 各 `var(--s4)`，合计 32px）。页面不再加左右内距。通栏页面用路由 `meta.bodyPad: 'none'`，两道一起去掉。
- 底部面板走 `web/src/services/sheet.ts`。一句话加按钮用 `title` / `message` / `actions`。带输入框或列表的用 `component` + `props`。选项多于两个时 `layout: 'stack'`。会议详情用 `layout: 'close-below'`，关闭独占下一行。个人页与用户设置的「编辑资料」共用 `web/src/services/profile-editor.ts`。
- 列表型页面的分区和筛选写进地址栏（`?tab=`），从二级页返回时才能回到同一分区。
- 切换方向由 `web/src/app/navigation.ts` 算出。二级页按路径深度写 `.app[data-direction]`（前进 / 后退 / 原地替换）。底部导航之间按导航顺序写 `.app[data-tab-move]`。`motion.css` 据此选过渡。冷启动的第一次跳转按原地替换处理，首帧静态落地。
- 标签页之间的过渡只位移、不淡入。淡入期间新页面还是透明的，露出来的是外壳背景，浅色模式下会闪一下白。同一屏只换 query 时方向信号保持不动，否则动画名会被换成淡入。
- 页面自己 `watch` query 完成切换的，在 `meta` 里声明 `queryInPlace: true`。外壳改用 `path` 作键，分区切换不重建页面，并预热那几个分区的读接口。
- 明暗模式与强调色在 `web/src/app/theme.ts` 落到 `<html data-mode>` 与 `--accent*`。首帧由 `index.html` 的内联脚本按本机缓存落一次。用户自己的明暗模式与强调色是账号偏好（`users.ui_mode` / `users.ui_theme`，经 `PUT /settings/ui-mode`、`PUT /settings/ui-theme` 保存）。本机只缓存一份供首帧使用。切换走 `web/src/app/preferences.ts`：本地先生效，落库失败回滚。`app_settings.theme` 只提供默认色板与全局默认下标。

新的应用页面在 `web/src/app/router.ts` 注册（`meta.title` / `back` / `tab`），并更新 `web/src/app/shell.test.ts` 的 `ROUTES`。报名站不写入 `ROUTES`。实现和产品行为冲突时，未决项写入 [`product.md`](product.md) 的待裁决项。

## 浏览器报名站

报名站是第二份构建：`web/join.html` 经 `web/vite.join.config.ts` 输出到 `web/dist-join`，由后端托管，不进 APK。`VITE_SURFACE=join` 只由这份配置注入，不写进 `web/.env`。是否托管见 [`server/README.md`](../server/README.md) 的模式表。

应用用 hash 路由。接口基址是构建时的 `APP_API_BASE`，没配则是 `http://127.0.0.1:<PORT>/api/v1`，媒体相对路径补到同一源。报名站用 history 路由，接口走相对的 `/api/v1`，媒体走相对的 `/media`。报名站不预取月历、展会列表、资料和管理数据。界面文案在 `web/src/i18n/strings.ts`，两份构建各自打包。

路径以报名站路由和 `web/src/app/surface.ts` 为准。声明顺序就是匹配顺序，更具体的路径写在前面。

## 数据加载

- 查询 composable 负责加载、缓存首屏、后台刷新和错误块。失败保持可见。页面已有内容时刷新只标记忙碌，不清空旧内容。过期响应丢弃。
- 查询缓存集中在 `web/src/services/query-cache.ts`。缓存键包含稳定序列化后的参数，并对相同请求去重。月视图一次取整月，点日期在本地完成。
- 写接口的失效前缀与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`、`users` ↔ `users.record`）。

## 原生桥接

原生只处理设备能力：`ui.sync`、摄像头权限、系统日历、通知权限、图片选择与媒体落盘、文本分享、CSV 导出，以及会话刷新令牌与可信设备凭据的设备存储（`session.save` / `session.load` / `session.clear` / `session.device`，见 `SessionStore.java`）。可信设备的随机凭据由原生 `session.device` 生成并保存在设备私有目录。浏览器预览使用本机存储。

`WebAppActions.handle()` 的动作表是唯一原生入口。业务数据动作留在服务端。动作失败回调 `callback.failure`。`AppSettings` 是后端设置的设备镜像，权威值由 `ui.sync` 下发。

日历只用后端下发的 `YYYY-MM-DD`。缺失或非法日期直接失败。

头像、封面和简介媒体上传到服务器。设备只负责选择和压缩，选完就把临时文件删掉。资源路径只允许单层文件名。大小、格式和存储上限由管理设置控制，口径见 [`server/README.md`](../server/README.md) 的媒体一节。头像格式只接受 jpg、jpeg、png、webp。

## 界面规则

- 每个字段有可见标签。标签和内容左对齐。
- 图标是 24 视窗、1.5 描边、无填充的细线。顶栏图标没有圆底。底部导航是图标加文字。
- 触控命中区域至少 44px。状态同时用文字和颜色或描边表达。空、加载、错误、成功和禁用状态在原位置给出下一步。
- 顶栏使用 `--topbar-h`，再叠 `--safe-top`。有底部导航时内容区叠 `--safe-bottom`。Android WebView 里这两项 `env()` 经常是 0，因此 `WebShellActivity` 按系统栏 inset 缩小页面。展会图保持 9:16。并排字段等高。日期、时间和状态使用选择器、分段控件或面板。
- 强调色使用 `--accent*`。二维码保持白底黑点。Markdown / HTML 先经 `web/src/services/markdown.ts` 清洗再渲染。
- 动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。动效全失时先看设备动画 scale，步骤见 [`operations.md`](operations.md)。
- 第三方库由 `web/package.json` 与锁文件管理。重型功能动态导入，构建进页面包，运行时不引用 CDN。页面包随 APK 带一份；正式包再从本站 `/app/` 热更新到本机快照，切换页面只读这份快照。
- 二维码在 Worker 里串行解码。暂停与换页后丢弃过期帧，离开时释放 Worker 和摄像头。WASM 通过构建资源定位到本地文件。

## 文案

界面文案在 `web/src/i18n/strings.ts`，按界面分区分层。前端用 `t('auth.login.title')` 这种点分路径读取。模板里的中文写成 `:placeholder="t('exhibition.form.venuePlaceholder')"` 这种绑定。周几、年月这类格式化常量留在 `web/src/services/format.ts`，不进这张表。邮件正文在后端，不进这张表。构建时这份表打进应用页面包和报名站包，不单独部署源文件。
