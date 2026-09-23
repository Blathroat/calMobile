# 后端迁移到 Hono + TypeScript（编译到 dist 运行）

**Status**: accepted

`server/` 从 Express 5 + 纯 JavaScript 迁移到 Hono 4 + TypeScript：`tsc` 编译到 `dist/`（镜像 `src/`），生产跑 `node dist/index.js`，开发用 `tsx watch src/index.ts`，测试统一到 vitest 双 project（单测 / 契约）。Node 运行时最低支持 22.12；Node 20 不列为支持版本。同时裁掉四个依赖（express、cors、express-validator、jsonwebtoken），其中 express-validator 经全库核实为零使用的死依赖。

## Considered Options

- **框架**：留 Express 套 TS 壳（`@types/express` 的 `Request` 扩展是老大难，28 个传递依赖的攻击面不变）；Fastify（schema 驱动序列化用不上，生态与 Web 标准 Context 不兼容）；Hono 4（官方 README 自测快 Express 5 约 3 倍，`@hono/node-server` 提供 `getConnInfo` 直接替代 `req.ip`，cors / logger / secure-headers / compress 均为内置子路径零额外依赖）。
- **TS 运行方式**：Node 22.12+ 提供稳定的 ESM 运行时；tsx 全场景（esbuild 二进制依赖）；tsc 编译到 dist——选 dist：**产物即所测**，sourcemap 排障，且 TS 语法不受可擦除约束。
- **测试 runner**：node:test（断言早已 100% `node:assert`）；留 jest；vitest——选 vitest：jest API（`vi.mock`/`vi.fn`/`vi.spyOn`/`vi.resetModules`）1:1 映射，13 个测试文件机械改名；双 project 把「要不要数据库」写进配置而非命令记忆。

## 留用与删除（防后人「修复」的刻意决定）

| 对象 | 决定 | 理由 |
|---|---|---|
| `pg` 裸用 | 留，不换 kysely/drizzle | `to_char` 日期、手写 BEGIN/COMMIT 事务、496 行 migrate 不值得为类型安全重写数据层；类型用 `query<T>` + 手写行接口补 |
| `bcryptjs` | 留 | 0 依赖、自带类型、哈希格式兼容；`@node-rs/bcrypt` 生态薄（周下载 1/50），argon2 需一次重散列迁移 |
| `nodemailer` | 留 | 0 依赖；console/smtp/memory 三 transport 与 `config/mail.js` 抽象精确匹配，迁移成本 0 |
| 自研限流 / TOTP / migrate.js | 留 | 单进程自有服务器部署；限流是安全边界，逻辑越透明越好审计 |
| `express.urlencoded` | 删 | 全库无调用方；JSON 2mb 上限改为自写 size-guard 中间件（Hono 无内置体积上限） |
| `hono/compress` | 仅挂 `/status` | 状态页 HTML 收益大；JSON 响应全局压缩是负收益 |
| 状态页渲染 | 保留服务端首屏 + 浏览器增量刷新 | 首屏直接给出完整报告，禁用 JavaScript 仍可读；浏览器每 5 秒局部刷新，服务端用约 1.5 秒短缓存合并紧邻请求；故障详情不回传，完整原因只写服务端日志 |
| `jsonwebtoken` | 换 `jose` | 0 依赖（原 10 个）；算法必须显式白名单，顺带补上现存 `verify` 不传 `algorithms` 的缺口 |
| 校验 | 手写 `validation.js` 换 `zod` | 共享原语集中 + 路由组合；TS 下可从 schema 推导入参类型 |

## Consequences

- **env 改名（对旧部署是破坏性的）**：删 `JWT_REFRESH_SECRET`（刷新令牌本就不是 JWT，它唯一真实用途是 TOTP 密钥兜底）；`TOTP_SECRET_KEY` 从选配扶正为必填；`JWT_REFRESH_EXPIRES_IN` 改名 `REFRESH_TOKEN_TTL`。缺 key 的旧部署启动即失败——响亮但不友好，这是选定直接改名的既定代价。
- **目录结构**：契约测试从 `test/api.test.js` 移入 `src/test/api.test.ts`，`rootDir: "src"` 使 dist 干净镜像；约 15 处文档与脚本引用（含 `scripts/smoke-check.js` 对该文件的内容断言）随迁。
- **契约测试改写**：状态页契约保留完整 SSR 首屏与内嵌报告断言；降级渲染测试覆盖数据库不可用时的通用错误提示与可读页面。
- **限流记账**：不再猴补丁 `res.json`，改为中间件 `await next()` 后 `c.res.clone()` 读信封 `ok === false`——行为保持，且只涉及 7 个低流量认证路由。
- **部署要求**：Node ≥ 22.12；上线多一步 `pnpm build`；状态页由服务端输出完整首屏，浏览器脚本只做后续局部刷新，禁用 JS 时仍能阅读首屏报告。
