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

正式包的文档地址是 `APP_API_BASE` 所在源的 `/app/index.html`。WebView 拦截 `/app/`，从本机快照读文件；还没有快照，或快照不是当前 `versionCode` 时，用 APK 里的那份。页面切换不再请求网络。首屏出来之后才在后台拉取 `/app/release.json`，新文件留到下次冷启动再换上。调试包（接口是 http）不热更新。只有 `/app/index.html` 能调用 `CalMobileNative`，其它链接交给系统浏览器。设备上选中、尚未上传的媒体仍从 `https://appassets.androidplatform.net/media/` 读取。页面要先 fetch 这份地址再上传，所以这份响应带上 `Access-Control-Allow-Origin`，值是页面文档的源。

新接口同时改 `web/src/api/client.ts`、`web/api-endpoints.mjs`、后端路由和 `server/src/test/` 下的契约测试。表单校验走 `web/src/services/validate.ts`，上限取 `useBootstrapStore().limits`。后端再校验一次。

## 应用外壳

外壳在 `web/src/app/App.vue`：`.app` 网格是顶栏、可滚动的内容区和底部导航（或页面页脚）。页面只往内容区放内容。

- 顶栏标题、返回键、底部导航项与内容区密度都由路由 `meta` 决定（`title` / `back` / `tab` / `bodyGap` / `bodyPad` / `bodyAlign` / `queryInPlace`）。导航项按角色过滤（`web/src/app/shell.ts`）。
- 页面级顶栏操作写在 `meta.topAction`（`{ icon, to, label }`，或 `{ icon, label, action: 'logout' }`）。外壳据此渲染右上角图标按钮。
- 固定操作区用 `<Teleport defer to="#app-foot">` 投递 `.page-foot`，落在网格第三行。`defer` 让目标元素与页面在同一次渲染里创建时也能找到。入口页是例外：注册和忘记密码两个文字入口跟在表单后面随内容滚动，不占页脚槽。
- 页面不自建 `.page` / `.topbar` / `.app-body` / `.tabbar`，也不写颜色、字号、间距与圆角。
- 内容区的左右内距由外壳给两道（`.app-body` 与路由容器 `.page-surface` 各 `var(--s4)`，合计 24px）。页面不再加左右内距。通栏页面用路由 `meta.bodyPad: 'none'`，两道一起去掉。
- 底部面板走 `web/src/services/sheet.ts`。一句话加按钮用 `title` / `message` / `actions`。带输入框或列表的用 `component` + `props`。选项多于两个时 `layout: 'stack'`。会议详情用 `layout: 'close-below'`，关闭独占下一行。个人页与用户设置的「编辑资料」共用 `web/src/services/profile-editor.ts`。
- 列表型页面的分区和筛选写进地址栏（`?tab=`），从二级页返回时才能回到同一分区。
- 切换方向由 `web/src/app/navigation.ts` 算出。二级页按路径深度写 `.app[data-direction]`（前进 / 后退 / 原地替换）。底部导航之间按导航顺序写 `.app[data-tab-move]`。`motion.css` 据此选过渡。冷启动的第一次跳转按原地替换处理，首帧静态落地。
- 标签页之间的过渡只位移、不淡入。淡入期间新页面还是透明的，露出来的是外壳背景，浅色模式下会闪一下白。同一屏只换 query 时方向信号保持不动，否则动画名会被换成淡入。
- 页面自己 `watch` query 完成切换的，在 `meta` 里声明 `queryInPlace: true`。外壳改用 `path` 作键，分区切换不重建页面，并预热那几个分区的读接口。
- 明暗模式与强调色在 `web/src/app/theme.ts` 落到 `<html data-mode>` 与 `--accent*`。首帧由 `index.html` 的内联脚本按本机缓存落一次。用户自己的明暗模式与强调色是账号偏好（`users.ui_mode` / `users.ui_theme`，经 `PUT /settings/ui-mode`、`PUT /settings/ui-theme` 保存）。本机只缓存一份供首帧使用。切换走 `web/src/app/preferences.ts`：本地先生效，落库失败回滚。`app_settings.theme` 只提供默认色板与全局默认下标。

新的应用页面在 `web/src/app/router.ts` 注册（`meta.title` / `back` / `tab`），并更新 `web/src/app/shell.test.ts` 的 `ROUTES`。报名站不写入 `ROUTES`。实现和产品行为冲突时，未决项写入 [`product.md`](product.md) 的待裁决项。

## 浏览器报名站

报名站是第二份构建：`web/join.html` 经 `web/vite.join.config.ts` 输出到 `web/dist-join`，由后端托管，不进 APK。`VITE_SURFACE=join` 只由这份配置注入，不写进 `web/.env`。是否托管见 [`server/README.md`](../server/README.md) 的模式表。

应用用 hash 路由。接口基址是构建时的 `APP_API_BASE`，没配则是 `http://127.0.0.1:<PORT>/api/v1`，媒体相对路径补到同一源。报名站用 history 路由，接口走相对的 `/api/v1`，媒体走相对的 `/media`。报名站不预取月历、展会列表、资料和管理数据。界面文案在 `web/src/i18n/zh.json`，两份构建各自打包。用户安装的语言包在本机，不在这两份包里。

路径以报名站路由和 `web/src/app/surface.ts` 为准。声明顺序就是匹配顺序，更具体的路径写在前面。

## 数据加载

- 查询 composable 负责加载、缓存首屏、后台刷新和错误块。失败保持可见。有上次结果（包括已过期的）时先画出那份内容，再在后台刷新；刷新只标记忙碌，不清空旧内容。过期响应丢弃。列表里新出现的卡片滑入，不重放整表。下拉刷新忽略新鲜期，重新取当前页。加载圈随手指出，松手后才转动并发起请求；响应再快也先滑入、在展开位置停留，再滑出。缓存已画出而后台还在更新时只标记忙碌，不弹这枚指示：切页面、返回旧页面都不播加载动画，指示圈只属于用户的手动下拉刷新（`web/src/services/pull-refresh.ts`）。竖拉还要先越过 16px 死区、并且纵向明显占优（> 横向 1.5 倍）才跟手：点击页面里的链接/按钮时手指会漂几像素，不过死区就完全当没下拉。手势中途横向追平即放弃这次下拉；页面自己的横滑处理器（首页日历）判定要横滑时调 `suppressPull()`，外壳本次手势直接作废，斜划不会闪出指示圈。只有真正的 `pointerup` 会发请求，`pointercancel`（浏览器接管手势）只复位、绝不刷新。换页时外壳再调一次 `resetPullVisual()`，保证上一页的手势与动画不会把圈留在新页面上。
- 查询缓存集中在 `web/src/services/query-cache.ts`。缓存键包含稳定序列化后的参数，并对相同请求去重。底部导航按下时预取该页。月视图一次取整月，点日期在本地完成。
- 写接口的失效前缀与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`、`users` ↔ `users.record`）。
- 展会详情页判断本人是否报过这场展会时复用 `registrations` 列表读缓存（与报名写入同族失效），只在已登录时请求；取不到就按未报名处理，不因为这条增强查询让整页失败。
- 核销结果按账号存在本机（`calmobile.checkin.outcomes.<用户 id>`，最多 20 条，最新的在前）；核销页顶栏的清理按钮清掉它，换号按新键重读。
- 接口 JSON 带 `Cache-Control: no-store`。前端请求使用 `cache: no-store`，避免浏览器把带身份的旧资料（包括头像地址）当成可复用响应。管理端用户列表和搜索结果都带上头像地址，上传后这些页面跟着换图。

## 原生桥接

原生只处理设备能力：`ui.sync`、摄像头权限、系统日历、通知权限、图片选择与媒体落盘、文本分享、CSV 导出、网页里的文件选择（`WebShellActivity` 的 `onShowFileChooser`）、文本文件读取与另存为（`media.importText` / `export.text`）、图片写进系统相册（`media.saveImage`），以及会话刷新令牌与可信设备凭据的设备存储（`session.save` / `session.load` / `session.clear` / `session.device`，见 `SessionStore.java`）。网页关着文件与 `content://` 访问，因此从文件安装语言包时正文由原生读出来回传，底稿另存为与二维码保存也走原生。可信设备的随机凭据由原生 `session.device` 生成并保存在设备私有目录。浏览器预览使用本机存储。

`WebAppActions.handle()` 的动作表是唯一原生入口。业务数据动作留在服务端。动作失败回调 `callback.failure`。`AppSettings` 是后端设置的设备镜像，权威值由 `ui.sync` 下发。

日历只用后端下发的 `YYYY-MM-DD`。缺失或非法日期直接失败。

头像、封面和简介媒体上传到服务器。设备只负责选择和压缩，选完就把临时文件删掉。资源路径只允许单层文件名。大小、格式和存储上限由管理设置控制，口径见 [`server/README.md`](../server/README.md) 的媒体一节。头像格式只接受 jpg、jpeg、png、webp。

## 界面规则

- 每个字段有可见标签。标签和内容左对齐。
- 图标是 24 视窗、1.5 描边、无填充的细线。顶栏图标没有圆底。底部导航是图标加文字。
- 触控命中区域至少 44px。生产界面以 1080×2400、xxhdpi（逻辑画布 360×800）为密度基准，字号、间距和圆角取 `web/src/styles/tokens.css` 的当前值。状态同时用文字和颜色或描边表达。空、加载、错误、成功和禁用状态在原位置给出下一步。
- 顶栏使用 `--topbar-h`，再叠 `--safe-top`。有底部导航时内容区叠 `--safe-bottom`。Android WebView 里这两项 `env()` 经常是 0，因此 `WebShellActivity` 按系统栏 inset 缩小页面。展会图保持 9:16。并排字段等高。日期、时间和状态使用选择器、分段控件或面板。
- 强调色使用 `--accent*`。二维码保持白底黑点。Markdown / HTML 先经 `web/src/services/markdown.ts` 清洗再渲染；Markdown 表格渲染成 1px 框线、列宽随内容、单元格可换行、放不下时表格自己横向滚动的样式（定义在 `.rich-content`）。管理-设置的保存按钮是右下角悬浮圆形按钮（`.round-action`，投递到 `body`，否则页面切换动画的 transform 祖先会改掉 `position: fixed` 的包含块）。
- 个人页与设置页按 `section-label` 分组：组标题放在卡片外，组内间距一档、组与组之间一档；卡片里的开关行用 `.switch-row[data-flush='true']` 的分隔线版式，不再套第二层边框；导航入口直接用 `.row-card`。身份卡用 `.card[data-tone='fill']`，名字用 `.identity-name`。
- 动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。动效全失时先看设备动画 scale，步骤见 [`operations.md`](operations.md)。
- 第三方库由 `web/package.json` 与锁文件管理。重型功能动态导入，构建进页面包，运行时不引用 CDN。页面包随 APK 带一份；正式包再从本站 `/app/` 热更新到本机快照，切换页面只读这份快照。
- 二维码在 Worker 里串行解码。暂停与换页后丢弃过期帧，离开时释放 Worker 和摄像头。WASM 通过构建资源定位到本地文件。

## 文案

界面文案在 `web/src/i18n/zh.json`，**嵌套 JSON**（`{"auth": {"login": {"title": "登录"}}}`）；前端仍用点分路径 `t('auth.login.title')` 读取，加载时压成扁平表，热路径不逐层查找。模板里的中文写成 `:placeholder="t('exhibition.form.venuePlaceholder')"` 这种绑定。别的语言缺哪条，就用中文那条。周几、年月留在 `web/src/services/format.ts`，不进这张表。邮件正文在后端，不进这张表。构建时中文表打进应用页面包和报名站包，不单独部署源文件。

用户自己的语言包记在本机 `localStorage`，不在 `web/dist` 或客户端快照里。语言包与内置中文表同一套嵌套格式（`strings` 里对象套对象、叶子是字符串），落盘时也写嵌套，否则升级后已装包会被当成坏包丢掉；旧的扁平包按约定不再兼容，服务器 `LANG_PACK_URLS` 指向的包也要换成嵌套版（「下载中文底稿」的输出可直接当模板）。个人设置可以切换语言，也可以粘贴链接或选择 JSON 文件安装（应用里由原生读文件正文，见「原生桥接」）。应用里选过的语言优先；没选过，且本机已有服务器默认名称对应的包时，用那个包。报名站不看个人设置：只有 `LANG_PACK_DEFAULT` 非空，并且这个名称写在 `LANG_PACK_URLS` 里、包也已经下载成功时，才用该语言，否则用中文。自动下载不会覆盖已经安装的同名包。切换语言后整页重新加载；安装成功的提示排到重载之后（`services/toast.ts` 的 `toastAfterReload`），重载后的首帧靠 `services/session-hint.ts` 那条本机提示先等会话恢复，不闪登录页。下载中文底稿在应用里走系统「另存为」，浏览器里退回浏览器下载。
