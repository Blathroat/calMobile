# 构建、测试与上线

本文件是跨模块的验证和上线步骤。后端启动、模式差异和响应约定见 [`server/README.md`](../server/README.md)。环境变量以 `server/.env.example` 的注释为准。Node 版本以 `server/package.json` 和 `web/package.json` 的 `engines` 为准。

前端 `vue-tsc` 停在 TypeScript 6（`web/package.json` 的 `typescript`）。当前 Vue 类型检查器用不上 TypeScript 7 的原生编译入口。后端使用 TypeScript 7。升级时保留 `.vue` 类型检查。

## 按改动验证

改完后，下表里对应命令的退出码为 0。

| 改动 | 命令 |
|---|---|
| Vue 页面、组件、样式、界面文案 | `pnpm --dir web typecheck`、`pnpm --dir web lint`、`pnpm --dir web fmt:check`、`pnpm --dir web test`、`pnpm --dir web build`。打 APK 时 `preBuild` 把 `web/dist` 同步到 WebView 资源 |
| 路由与加载 | `pnpm --dir web test` |
| 后端规则或响应 | `pnpm --dir server lint`、`pnpm --dir server fmt:check`、`pnpm --dir server test`，以及 `pnpm --dir server test:contract`（需要 PostgreSQL）。改了已加载的 `server/src` 后重启不用 watch 起的进程 |
| Java 或桥接 | `gradlew.bat :app:testDebugUnitTest`。出包或资源变更再跑 `gradlew.bat :app:assembleDebug` |

契约测试先由 `server/test/global-setup-contract.ts` 建一个模板库，每个测试文件从它克隆一份自己的库：文件之间互不干扰，因此可以并行跑，迁移与示例数据只跑一次。行尾由根目录 `.gitattributes` 统一成 LF，检出后不用手工调整。

设备连不上后端时，先读 `server/src/dev/adb-reverse.ts` 开头。`pnpm dev` 会维护 `adb reverse tcp:3000 tcp:3000`。服务不是它起的时候，自己执行这条命令。

动效全部静止时，先看三枚系统动画 scale。都为 1 之后，再改代码：

```
adb shell settings get global animator_duration_scale
adb shell settings get global transition_animation_scale
adb shell settings get global window_animation_scale
```

要打开动画，对这三枚执行 `adb shell settings put global <name> 1`。应用重新进入页面后才会重新读取。

## 上线

服务只监听 HTTP。TLS、证书和 HTTP/2 由前面的反向代理终止。

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}
```

发布前下面每一项都成立：

1. `pnpm start` 的自检通过。生产不跑 `pnpm db:seed`。自检会拒绝启动的项和只警告的项，见 [`server/README.md`](../server/README.md) 的模式表。
2. 反代只暴露 443，并送出 `X-Forwarded-Proto` 与 `X-Forwarded-For`。服务端设 `TRUST_PROXY=1`。
3. 确认 https 全站可用之后，再开 `FORCE_HTTPS` 和长 `HSTS_MAX_AGE`。
4. `CORS_ORIGIN` 写成真实来源。
5. 状态页保持关闭，或在反代上加 Basic Auth 并只允许内网访问。公网探活只用 `/ping`。
6. `JWT_SECRET` 与 `TOTP_SECRET_KEY` 各自至少 32 个随机字符。数据库口令不是示例值。`MAIL_FROM_ADDRESS` 已显式配置。邮件走托管 SMTP。
7. Node 版本满足 `engines`。在 `server/` 执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，再执行 `pnpm db:migrate:prod`，迁移完成后再切流量。
8. 数据库时区是 `Asia/Shanghai`。原因写在仓库根 `docker-compose.yml`。备份和恢复演练已经做过。
9. `client_max_body_size` 盖住视频单文件上限。视频默认 50MB 时至少写 `64m`。头像那一道传输硬顶盖不住视频。上传目录和开关见 `server/.env.example`。存满之后的产品行为见 [`product.md`](product.md)。
10. 注册和安全邮件涉及个人信息，注册页有隐私告知。营销或提醒邮件有退订。
11. 客户端生产构建关闭明文放行：`usesCleartextTraffic` 与 `MIXED_CONTENT_ALWAYS_ALLOW`。
