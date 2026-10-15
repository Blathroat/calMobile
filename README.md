# CalMobile

CalMobile 是展会排期助手：浏览月历、查看展会、在线报名、审核和现场核销。界面由 WebView 承载，业务数据在 Hono + PostgreSQL 后端，Android 原生只提供设备能力。

开发与运行要求 Node.js 24.15+（24.x）或 26+，并使用 pnpm 管理依赖。首次启动后端前，请在 `server/.env` 中将 `JWT_SECRET` 和必填的 `TOTP_SECRET_KEY` 换成各自独立、至少 32 个字符的随机密钥。

## 快速开始

```bash
docker compose up -d
cd server
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

后端状态页：`http://127.0.0.1:3000/status`。真机或模拟器访问本机后端时运行 `adb reverse tcp:3000 tcp:3000`；构建客户端运行 `gradlew.bat :app:assembleDebug`。

## 文档

| 文档 | 适用场景 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 代理必须遵守的硬约束与验证入口 |
| [`docs/product.md`](docs/product.md) | 产品行为、验收场景、当前限制和未决项 |
| [`docs/engineering.md`](docs/engineering.md) | 前后端边界、页面映射、界面实现规则 |
| [`docs/operations.md`](docs/operations.md) | 测试、模拟器回归、构建与上线检查 |
| [`server/README.md`](server/README.md) | 后端接口、数据库、环境变量、服务骨架和依赖取舍 |
| [`docs/agents/`](docs/agents/) | Issue、分流标签和领域文档约定 |

## 常用验证

```bash
node scripts/smoke-check.js
node scripts/webui-check.js
node --test scripts/webui-render.test.js
node scripts/check-strings.js
pnpm --dir server build
pnpm --dir server typecheck
pnpm --dir server test
pnpm --dir server test:contract
gradlew.bat :app:testDebugUnitTest
```

完整命令按任务查阅 [`docs/operations.md`](docs/operations.md) 和 [`server/README.md`](server/README.md)。文档只描述当前状态，历史记录看 `git log`。
