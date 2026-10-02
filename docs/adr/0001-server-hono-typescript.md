# 后端迁移到 Hono + TypeScript（编译到 dist 运行）

**Status**: accepted

`server/` 使用 Hono 4 + TypeScript：`tsc` 编译到 `dist/`（镜像 `src/`），生产跑 `node dist/index.js --production`，开发用单一 `tsx watch scripts/dev.ts` 入口重建状态页资源并重启服务，测试统一到 vitest 双 project（单测 / 契约）。Node.js 支持 24.15+（24.x）或 26+。所有路由（含状态页）直接由 Hono 提供；访问令牌使用 `jose` 并固定 HS256，刷新令牌仍是随机串并只存哈希。

## Considered Options

- **框架**：留 Express 套 TS 壳（`@types/express` 的 `Request` 扩展是老大难，28 个传递依赖的攻击面不变）；Fastify（schema 驱动序列化用不上，生态与 Web 标准 Context 不兼容）；Hono 4（官方 README 自测快 Express 5 约 3 倍，`@hono/node-server` 提供 `getConnInfo` 直接替代 `req.ip`，cors / logger / secure-headers / compress 均为内置子路径零额外依赖）。
- **TS 运行方式**：生产部署以 Node.js 24 LTS 为最低版本；开发使用 tsx，生产使用 tsc 编译到 dist——选 dist：**产物即运行文件**，sourcemap 便于排障，且 TS 语法不受可擦除约束。
- **测试 runner**：选 vitest 双 project，把是否需要数据库写进配置而非命令记忆；断言使用 `node:assert`，unit 与 contract 项目分别运行。

## 留用与删除（防后人「修复」的刻意决定）

| 对象 | 决定 | 理由 |
|---|---|---|
| `pg` 裸用 | 留，不换 kysely/drizzle | `to_char` 日期、手写 BEGIN/COMMIT 事务、496 行 migrate 不值得为类型安全重写数据层；类型用 `query<T>` + 手写行接口补 |
| `bcryptjs` | 留 | 0 依赖、自带类型、哈希格式兼容；`@node-rs/bcrypt` 生态薄（周下载 1/50），argon2 需一次重散列迁移 |
| `nodemailer` | 留 | 0 依赖；console/smtp/memory 三 transport 与 `config/mail.ts` 抽象精确匹配，迁移成本 0 |
| 自研限流 / TOTP / migrate.ts | 留 | 单进程自有服务器部署；限流是安全边界，逻辑越透明越好审计 |
| `express` 兼容层 | 删 | #12–#15 的业务迁移完成后没有 Express 调用方；状态页在 #16 直接接入 Hono |
| `hono/compress` | 不引入 | 状态页单文件体积可控；JSON 响应全局压缩是负收益 |
| 状态页渲染 | 构建期拆分源码、运行时单文件输出；客户端纯渲染模块 + 内联 INITIAL + 浏览器增量刷新 | `server/status-page/` 分开维护 HTML、CSS、客户端 TypeScript 脚本和降级页，构建成 `src/status-page-assets.ts`；服务端只注入清洗后的 INITIAL，数据库和渲染错误只显示通用提示 |
| `jose` | 留用 | 会话模块统一封装访问令牌签发与校验，并固定 HS256；刷新令牌仍是随机串并只存哈希 |
| 校验 | Zod schema | 请求规则集中在 schema，类型从 schema 推导，并复用共享原语组合路由校验 |

## Consequences

- **认证环境变量**：`JWT_SECRET` 与 `TOTP_SECRET_KEY` 都必须是至少 32 个字符的非占位值；刷新令牌是数据库中可撤销的不透明随机串，不需要第二个 JWT 密钥；刷新令牌有效期读取 `REFRESH_TOKEN_TTL`。若旧部署曾用 `JWT_REFRESH_SECRET` 兜底加密验证器密钥，迁移时须将其原值复制到 `TOTP_SECRET_KEY`。
- **目录结构**：契约测试位于 `src/test/api.test.ts`，`rootDir: "src"` 使 dist 干净镜像；测试由 vitest contract project 运行。
- **契约测试改写**：状态页测试在 VM 中执行构建后的内联脚本，覆盖 INITIAL、数据库不可用、迁移待应用和通用错误提示；不再要求完整 SSR 首屏。
- **限流记账**：不再猴补丁 `res.json`，改为中间件 `await next()` 后 `c.res.clone()` 读信封 `ok === false`——行为保持，且只涉及 7 个低流量认证路由。
- **部署要求**：Node.js 24.15+（24.x）或 26+；在 `server/` 执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，后者生成状态页资源模块并编译生产产物；生产数据库迁移使用 `pnpm db:migrate:prod`。状态页由客户端脚本渲染首屏和后续局部刷新，禁用 JavaScript 时只显示启用提示。
