# 工程边界与界面实现

本文件是客户端、前后端边界和界面实现规则的来源。后端完整接口、数据模型和错误细节见 [`server/README.md`](../server/README.md)；视觉交付件见 [`newUI/`](newUI/)。

## 系统边界

业务数据只有一处来源：`server/` 的 PostgreSQL。前端不复制业务规则，原生不实现业务数据；后端不可用时页面明确报错，不做本地降级。

| 层 | 责任 | 权威入口 |
| --- | --- | --- |
| WebView 页面 | 路由、渲染、表单和用户交互 | `app/src/main/assets/web/` |
| 前端数据 | 类型化 REST client、令牌续期、缓存 | `web/src/api/client.ts`；契约表为 `web/api-endpoints.mjs` |
| 前端加载 | 缓存首屏、后台刷新、错误呈现 | `js/core/loadable.js` 的 `loadInto()` |
| 原生桥接 | 日历、通知权限、摄像头、媒体、分享、CSV、设备镜像 | `WebAppActions.handle()` 的固定动作表 |
| 后端 | 认证、业务规则、持久化、邮件和接口 | `server/src/` |

## 前端结构

```text
web/
├── index.html
├── src/app/                启动、路由、运行时
├── src/api/                类型化领域 API
├── src/services/           HTTP、缓存、原生桥接、设备能力
├── src/stores/             Pinia 跨页面状态
├── src/pages/              Vue 页面
└── src/styles/             设计令牌与动效
```

页面不直接 `fetch`，也不通过原生桥接取业务数据。读取接口直接返回数据；写接口返回 `{ ok, error, ... }`。接口规则和前端动作必须在 `web/src/api/client.ts`、`web/api-endpoints.mjs`、后端路由、契约测试四处同时更新。

## 屏幕对照

| 编号 | 页面模块 | 主要用途 |
| --- | --- | --- |
| 01 | `pages/login.js` | 登录或访客入口 |
| 02 | `pages/home.js` | 月视图与当天展会 |
| 03 | `pages/detail.js` | 详情、报名、日历、分享 |
| 04 | `pages/registration-form.js` | 填写报名 |
| 05 | `pages/register.js` | 两步注册 |
| — | `pages/forgot-password.js` | 找回密码 |
| 06 | `pages/search.js` | 搜索展会、地点和用户 |
| 07 | `pages/my-registrations.js` | 我的报名 |
| 08 | `pages/registration-detail.js` | 报名详情与撤销 |
| 09 | `pages/profile.js` | 个人资料、安全和外观 |
| 10 | `pages/exhibitor.js` | 展商后台 |
| 11 | `pages/exhibition-form.js` | 展会编辑 |
| 12 | `pages/rich-editor.js` | Markdown 简介与媒体 |
| 13 | `pages/review.js` | 报名审核 |
| 14 | `pages/user-public.js` | 用户公开页 |
| 15 | `pages/admin.js` | 管理后台 |
| — | `pages/checkin.js` | 现场核销工具 |

设计稿的 16、17 屏已内联到管理后台和个人页设置；核销也属于展商后台入口，不新增二级页面。新增页面必须同时更新 `app.js` 路由、本表和 `scripts/webui-render.test.js` 的 `ROUTES`。

## 数据加载规则

- `loadInto()` 负责加载、缓存首屏、后台刷新和错误块；不要用 `Promise.allSettled` 吞掉失败，也不要把未知状态显示成成功。
- 查询缓存集中在 `web/src/services/query-cache.ts`；缓存键包含稳定序列化后的参数，并对相同请求去重。月视图一次取整月，点日期在本地完成，不重复请求。
- 页面已有内容时刷新只标记忙碌，不清空旧内容；过期响应丢弃，避免慢请求覆盖新视图。

## 原生桥接

原生只处理以下设备能力：`ui.sync`、摄像头权限、系统日历、通知权限、图片选择与媒体落盘、文本分享和 CSV 导出。`AppSettings` 是后端设置的设备镜像；日历用后端下发的 ISO 日期定位，失败必须回调失败。

媒体落在应用私有目录 `files/media`，前端只保存短 URL；资源路径只允许单层文件名。业务数据动作不加入原生动作表。

## 界面规则

- `docs/newUI/` 是视觉来源；生产样式集中在 `styles/tokens.css` 和 `styles/motion.css`，页面不重复写颜色、字号、间距或圆角。
- 触控命中区域至少 44px；状态同时使用文字与颜色或描边；空、加载、错误、成功和禁用状态在原位置给出下一步。
- 顶栏使用 `--topbar-h`；展会图保持 9:16；并排字段使用等高布局；日期、时间和状态使用选择器、分段控件或面板。
- 强调色使用 `--accent*`；二维码保持白底黑点；Markdown / HTML 渲染前经过 `js/core/sanitize.js`。
- 动效只动画 `transform` 与 `opacity`，并遵守 `prefers-reduced-motion`。动效全失时先检查设备 `animator_duration_scale`，再改代码。
- 第三方库必须内置到 `web/public/vendor/` 并记录版本和许可证，不引用 CDN 或图标字体。

## 文案与资源

用户可见文案写入 `app/src/main/res/values/strings_frontend.xml`，前端用 `t('key')` 读取。源码变更后运行 `node scripts/extract-strings.js --write`，再运行 `node scripts/check-strings.js` 检查源码、资源和 `FrontendStrings.NAMES`。资源首尾不得有空白。

## 设计来源

- `newUI/index.html` 和 `remaining-ui.html` 是流程线框源。
- `newUI/ui-spec.md` 是灰盒组件、表单、屏幕和交互规则。
- `newUI/DESIGN-HANDOFF.md` 是实现保真、响应式和可访问性合同。
- `newUI/DESIGN-MANIFEST.json` 是机器可读的屏幕和交互索引。

发生设计稿与实现冲突时，只把未决决策写入 [`docs/product.md`](product.md)；不要在多个文档重复解释同一条规则。
