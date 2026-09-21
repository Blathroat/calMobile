# CalMobile

CalMobile 是展会排期助手：按月历浏览展会、查看详情、在线报名、审核与现场核销。

界面由 WebView 承载 `docs/newUI/` 的设计交付件（页面资源在 `app/src/main/assets/web/`），业务数据全部来自 `server/` 的 Express + PostgreSQL 后端，Android 原生只保留「只有设备能做」的系统能力：系统日历、通知与摄像头权限、媒体选择与落盘、分享、CSV 导出、系统栏配色。后端连不上时应用直接报错并给出排查提示，没有本地降级路径。

## 快速开始

```bash
# 1. 起数据库（PostgreSQL 容器 calmobile-pg）与本地收件箱（Mailpit）
docker compose up -d
cd server
pnpm install
cp .env.example .env          # 按需改数据库连接与 JWT 密钥
pnpm db:migrate           # 建表（可反复执行）
pnpm db:seed              # 示例账号与展会
pnpm dev                  # http://127.0.0.1:3000（状态页 /status）

# 2. 出包并装到设备，把设备端口指向本机后端
gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb reverse tcp:3000 tcp:3000
```

两个服务定义在仓库根的 `docker-compose.yml`（镜像版本、时区、数据卷都在那里，日常启停也可用薄封装 `pwsh -File scripts\db.ps1 start` 与 `pwsh -File scripts\mail.ps1 start`）。

示例账号：`demo`（管理员）、`exhibitor`（展商）、`user`（普通用户），密码都是 `password`；未登录只能浏览公开展会。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `app/src/main/assets/web/` | 前端页面、样式与 ES 模块（一屏一文件，共 17 个页面） |
| `app/src/main/java/com/example/calmobile/` | WebView 容器与 10 个系统动作的原生实现 |
| `app/src/main/res/values/strings_frontend.xml` | 前端用户可见文案（由 `scripts/extract-strings.js` 生成） |
| `server/` | Express + PostgreSQL 后端，独立的 Node.js 服务，不属于 Gradle 模块 |
| `scripts/` | 检查脚本、模拟器与数据库辅助脚本 |
| `docs/` | 架构、功能、界面规范、构建与上线、路线图 |
| `docs/newUI/` | 设计交付件（线框、设计规范与交付说明），界面标准的来源 |

## 技术栈

- **客户端**：Java 25 + Android SDK（`compileSdk 36.1`、`targetSdk 36.1`，Gradle 9.7.1 + AGP 9.4.1）。界面是 WebView 承载的原生 HTML/CSS/ES 模块，没有打包器与构建步骤；运行时依赖只有 Gson（桥接层 JSON）与 JUnit（单元测试）。
- **前端**：设计令牌集中在 `styles/tokens.css`，动效集中在 `styles/motion.css`；第三方库内置在 `assets/web/vendor/`，不引用 CDN 或图标字体；数据一律走 `js/core/api.js` 这一个入口。
- **后端**：Node.js + Express + PostgreSQL，JWT 认证，REST 接口按资源分路由；写操作返回 `{ ok, error, ... }` 信封，状态存英文代码、中文标签只映射一次。

## 常用命令

```bash
# 结构与前端静态检查（改动文档、页面或依赖后都要跑）
node scripts/smoke-check.js
node scripts/webui-check.js
node scripts/check-strings.js

# 测试
node --test scripts/smoke-check.test.js
node --test scripts/webui-render.test.js     # 前端逐页渲染冒烟
node --test server/test/api.test.js          # 前后端契约（需要数据库）
gradlew.bat :app:testDebugUnitTest
```

后端命令（在 `server/` 里）：`pnpm dev`（开发模式）、`pnpm start`（生产模式，关掉状态页并做启动自检）、`pnpm test`（jest 单测）、`pnpm test:contract`（接口契约）、`pnpm lint`（oxlint）与 `pnpm format`（oxfmt）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/architecture.md` | 前端架构与目录结构、桥接协议、页面与设计稿对照、前后端边界、取数体验、数据边界、系统动作与接口对照 |
| `docs/features.md` | 产品范围与角色、已实现的关键交互、验收场景 |
| `docs/ui-standards.md` | 界面标准、设计令牌与配色作用范围、深色模式、动效标准 |
| `docs/deployment.md` | 构建、测试与运行、模拟器回归、启动耗时打点、上线部署清单与开销、隐私与合规 |
| `docs/roadmap.md` | 路线图与已知限制、待裁决清单（未决项） |
| `docs/newUI/` | 设计交付件：线框 `index.html` / `remaining-ui.html`、`ui-spec.md`、`DESIGN-HANDOFF.md`、`DESIGN-MANIFEST.json` |
| `server/README.md` | 后端的环境变量、数据库与邮件通道、响应约定、完整接口清单、业务规则与测试 |
| `AGENTS.md` | 贡献者与自动化代理的工作约定（编码规范、验证顺序、提交要求） |

文档只描述**当前状态**：不写变更记录、不写迁移过程，历史看 `git log`；已解决的问题从清单里删掉，而不是标注「已完成」。
