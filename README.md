# CalMobile

CalMobile 是展会排期助手：浏览月历、查看展会、在线报名、审核和现场核销。界面由 WebView 承载，业务数据在 Hono + PostgreSQL 后端，Android 原生只提供设备能力。

## 快速开始

```bash
docker compose up -d
cd server
pnpm install
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
| [`server/README.md`](server/README.md) | 后端接口、数据库、环境变量和服务骨架 |
| [`docs/newUI/`](docs/newUI/) | 视觉设计源和机器可读交付件 |
| [`docs/adr/`](docs/adr/) | 不可轻易反转的技术决策 |
| [`docs/agents/`](docs/agents/) | Issue、分流标签和领域文档约定 |

## 常用验证

```bash
node --test scripts/webui-render.test.js
node scripts/check-strings.js
pnpm --dir server test
pnpm --dir server test:contract
gradlew.bat :app:testDebugUnitTest
```

完整命令按任务查阅 [`docs/operations.md`](docs/operations.md) 和 [`server/README.md`](server/README.md)。文档只描述当前状态，历史记录看 `git log`。
