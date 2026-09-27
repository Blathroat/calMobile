# 构建、测试与上线

本文件只保留跨模块的操作流程。后端命令、环境变量、迁移和状态页细节见 [`server/README.md`](../server/README.md)。

后端要求 Node.js ≥ 24.0.0。部署与本地开发使用仓库提交的 `server/pnpm-lock.yaml`，安装依赖时启用冻结锁文件。

## 本地运行

```bash
docker compose up -d
cd server
pnpm install --frozen-lockfile
cp .env.example .env
# 将 JWT_SECRET 与必填的 TOTP_SECRET_KEY 分别换成独立的随机密钥（至少 32 个字符）
pnpm db:migrate && pnpm db:seed
pnpm dev
```

开发模式打开 `/status`；生产使用 `pnpm start`，默认关闭状态页并执行配置自检。生产数据库迁移使用 `pnpm db:migrate:prod`。改动 `server/src` 后重启进程。

## 验证顺序

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
gradlew.bat :app:assembleDebug
```

按改动范围运行必要项目：

- Vue 前端重构：`node scripts/webui-vue-check.js`；生成 APK 时 `preBuild` 自动将 `web/dist` 同步到 generated WebView 资源。

- 前端路由、加载和文案：渲染测试、字符串检查。
- 后端规则或响应：服务端单测与契约测试；数据库相关测试需要 PostgreSQL。
- Java 或桥接：`testDebugUnitTest`；出包或资源变更再运行 `assembleDebug`。
- 前端文案源码变更后先运行 `node scripts/extract-strings.js --write`。

## 模拟器与真机回归

```powershell
pwsh -File scripts\emu.ps1 install
pwsh -File scripts\emu.ps1 shot .omo\evidence\screen
pwsh -File scripts\emu.ps1 logs
pwsh -File scripts\emu.ps1 motion check
```

安装 APK 后用 `adb reverse tcp:3000 tcp:3000` 连接本机后端。WebView 文字不一定出现在无障碍树中，点击回归用坐标并保留截图证据；扫码回归可用 `node scripts/decode-shot.js` 检查真实截图像素。

动效全部静止时，先确认三个动画 scale 都为 1：

```powershell
pwsh -File scripts\emu.ps1 motion check
pwsh -File scripts\emu.ps1 motion
```

## 发布检查

发布前确认：

- 生产使用 HTTPS 和反向代理，`CORS_ORIGIN` 只允许 WebView 来源；客户端关闭明文放行。
- 分别配置访问令牌密钥 `JWT_SECRET` 与必填的验证器加密密钥 `TOTP_SECRET_KEY`（各自至少 32 个随机字符），更换数据库凭据，并显式配置 `MAIL_FROM_ADDRESS`；邮件使用托管 SMTP，不部署 Mailpit，不使用 `memory` 或仅写日志的通道。
- 生产状态页默认关闭；临时打开时用反代 Basic Auth 或 IP 白名单，公网探活只使用 `/ping`。
- 使用 Node.js ≥ 24.0.0，在 `server/` 执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，再执行 `pnpm db:migrate:prod` 并重启生产进程；迁移完成后才切流量。
- 数据库启用 `Asia/Shanghai` 时区，配置备份、恢复演练和日志轮转。
- 上传媒体仍在客户端私有目录；上线前确认这符合产品范围，或先完成对象存储和上传接口。
- 注册和安全邮件涉及个人信息，注册页需要隐私告知；营销或提醒邮件需要退订机制。

## 上线限制

当前服务没有默认的公网部署形态、域名和 HTTPS。已有域名与服务器时，证书可用 Let's Encrypt；成本、邮件服务和备案取决于部署地区，具体供应商额度不写入代码文档。

发布完成后检查生产日志中的运行模式、配置自检和邮件失败计数；故障详情留在服务端日志，不向客户端返回数据库地址、SQL 或堆栈。
