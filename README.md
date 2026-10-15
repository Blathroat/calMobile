# CalMobile

展会排期助手：浏览月历、查看展会、在线报名、审核和现场核销。界面在 WebView 里，业务数据在 Hono + PostgreSQL，Android 原生只提供设备能力。

启动、迁移和开发 / 生产差异见 [`server/README.md`](server/README.md)。Node 版本以 `server/package.json` 和 `web/package.json` 的 `engines` 为准。

## 文档

| 文档                                         | 什么时候读                               |
|----------------------------------------------|------------------------------------------|
| [`AGENTS.md`](AGENTS.md)                     | 每次改代码。只放不看就会写错的规则       |
| [`docs/product.md`](docs/product.md)         | 用户可见行为、当前限制、未决项           |
| [`docs/engineering.md`](docs/engineering.md) | 边界、外壳、数据加载、界面规则           |
| [`docs/operations.md`](docs/operations.md)   | 按改动验证、上线                         |
| [`server/README.md`](server/README.md)       | 服务骨架、响应约定、依赖取舍、开发与生产 |
| [`docs/agents/`](docs/agents/)               | 工单、分流标签、领域文档                 |
