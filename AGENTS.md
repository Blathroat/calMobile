# Repository Guidelines

> 只写不遵守就会出错的规则。代码、配置和 `package.json` 已经表达的事实不重复；按主题查阅 `docs/`，后端细节查 `server/README.md`。

## 开始与验证

- 先读与任务对应的文档：产品行为看 [`docs/product.md`](docs/product.md)，边界与界面看 [`docs/engineering.md`](docs/engineering.md)，构建与上线看 [`docs/operations.md`](docs/operations.md)。修改后端骨架前先读 [`server/README.md`](server/README.md) 的服务骨架部分。
- 后端要求 Node.js ≥ 24.0.0。按影响范围验证：`node scripts/smoke-check.js`、`node scripts/webui-check.js`、`node --test scripts/webui-render.test.js`、`node scripts/check-strings.js`、`pnpm --dir server build`、`pnpm --dir server typecheck`、`pnpm --dir server test`、`pnpm --dir server test:contract`、`gradlew.bat :app:testDebugUnitTest`、`gradlew.bat :app:assembleDebug`。
- 前端文案源码变更后运行 `node scripts/extract-strings.js --write`；服务端源码变更后重启进程。

## 边界

- `app/` 是 Java 25 的 WebView 容器；页面源码在 `web/`，构建后由 Gradle 同步到 generated assets。原生只实现设备能力，数据和业务规则留在后端。
- `server/` 是独立的 Hono + PostgreSQL Node 服务，不是 Gradle 模块。数据库是唯一业务数据源；旧 Room、Retrofit、本机 SQLite 和 legacy 页面不再引入。
- `docs/newUI/` 的 HTML、JSON、`ui-spec.md` 和 `DESIGN-HANDOFF.md` 是界面来源；实现与设计冲突时，把未决项记入 [`docs/product.md`](docs/product.md)。

## 前端硬约束

- 数据只走 `web/src/api/client.ts`；页面取数统一用 feature composable，失败必须可见。
- 查询缓存只放 `web/src/services/query-cache.ts`，缓存键包含解析后的参数；不以原生桥接承载业务数据，也不做本地降级。写接口的失效前缀要与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`），否则改完再读会命中旧值。
- 用户可见文案写入 `strings_frontend.xml` 并用 `t('key')` 读取；资源首尾不留空白。颜色、字号、间距、圆角只写入 `styles/tokens.css`，动效只写入 `styles/motion.css`。
- 页面只提供内容：外壳（`src/app/App.vue` 的顶栏 + 滚动内容区 + 底部导航 + 页脚槽）与 `src/app/shell.ts` 的导航项是唯一容器，页面不再自建 `.page` / `.topbar` / `.app-body`；固定操作区用 `<Teleport defer to="#app-foot">` 投递，顶栏右侧操作写在路由 `meta.topAction`。
- 个人偏好（明暗模式、强调色）按账号保存（`users.ui_mode` / `users.ui_theme`），本机只缓存首帧；切换统一走 `src/app/preferences.ts`（本地先生效、落库失败回滚），不要把偏好写进 `app_settings`。
- Markdown / HTML 先经 Vue service 的 sanitize 入口；第三方库内置在 `web/public/vendor/`，不引用 CDN，并只在用到的那一屏按需注入（`src/services/vendor.ts`）。
- 新页面在 `web/src/app/router.ts` 注册（含 `meta.title / back / tab`），同时更新 [`docs/engineering.md`](docs/engineering.md) 的屏幕表和 `web/src/app/shell.test.ts` 的 `ROUTES`；管理功能优先内联。
- 表单校验走 `web/src/services/validate.ts`，上限取 `useBootstrapStore().limits`；后端仍需再次校验。

## 原生硬约束

- 日历按后端下发的 `YYYY-MM-DD` 定位；缺失或非法日期直接失败，不猜年月。
- 动作失败回调 `callback.failure`；`AppSettings` 只是设备镜像，权威值由 `ui.sync` 下发。
- `WebAppActions.handle()` 的动作表是唯一原生入口；不要把数据实现加进原生。

## 后端硬约束

- 数据库存英文代码，中文标签只在 `server/src/domain/labels.ts` 映射。
- 写接口返回 `{ ok, error, ... }`；规则失败用 200 + `ok:false`，认证授权用 4xx，数据库不可用用 503。响应不暴露 pg 原文、SQL 或堆栈。
- 新接口同时更新 `web/api-endpoints.mjs` 的契约表、后端路由和 `server/src/test/api.test.ts`；错误分类集中在 `server/src/http/error-response.ts`。
- 公开接口不下发 `checkInCode` 等凭据；两步验证未通过时不发任何令牌。邮箱是唯一且已验证的身份，改邮箱必须先验证新地址。
- 运行模式读 `server/src/config/runtime.ts`；`pnpm dev` 用于开发，`pnpm start` 用于生产自检。服务骨架的适配器、安全头、CORS、请求日志和体积守卫规则见 `server/README.md`。
- 邮件由 `server/src/services/mailer.ts` 发送；发码先落库、立即回包、后台发信，不在应用服务器自建 SMTP。

## 界面、文档与提交

- 触控命中区域至少 44px；状态同时用文字和视觉差异表达；详细界面规则见 [`docs/engineering.md`](docs/engineering.md)。回归界面前运行 `pwsh -File scripts\emu.ps1`；动效异常先运行 `pwsh -File scripts\emu.ps1 motion check`。
- 文档只描述当前状态；新增或更新需求按 `product.md`、`engineering.md`、`operations.md` 分流，不创建重复主题文档。ADR 和协作配置按需阅读。
- Java 四空格、PascalCase 类名、camelCase 成员、`snake_case` 资源；前端 class 与页面文件用 kebab-case；注释和文档用中文。提交使用简洁中文动词短句，只提交本次路径。

## Agent skills

### Issue tracker

工单在本仓库 GitHub Issues，用 `gh` 读写。详见 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。

### Triage labels

五个分流角色与标签同名：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。

### Domain docs

布局为 single-context（根目录没有 `CONTEXT.md` 时继续工作，ADR 在 `docs/adr/`）。详见 [`docs/agents/domain.md`](docs/agents/domain.md)。
