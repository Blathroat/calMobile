# 构建、测试与上线

本文件是跨模块的验证和上线步骤。后端启动、模式差异和响应约定见 [`server/README.md`](../server/README.md)。环境变量以 `server/.env.example` 的注释为准。Node 版本以 `server/package.json` 和 `web/package.json` 的 `engines` 为准。

前端 `vue-tsc` 停在 TypeScript 6（`web/package.json` 的 `typescript`）。当前 Vue 类型检查器用不上 TypeScript 7 的原生编译入口。后端使用 TypeScript 7。升级时保留 `.vue` 类型检查。

## 按改动验证

改完后，下表里对应命令的退出码为 0。脚本自身的参数写在脚本开头，这里只写什么时候跑哪一个。

| 改动                 | 命令                                                                                                                                     |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Vue 页面、组件、样式 | `node scripts/webui-check.js`（类型检查、单测、生产构建）。打 APK 时 `preBuild` 把 `web/dist` 同步到 WebView 资源                        |
| 路由、加载、文案绑定 | `node --test scripts/webui-render.test.js`，以及 `node scripts/check-strings.js`                                                         |
| 前端文案源码         | 先 `node scripts/extract-strings.js --write`，再跑 `check-strings`。脚本替换范围见 [`engineering.md`](engineering.md)                    |
| 界面有没有整块丢失   | `node scripts/ui-parity.mjs`。有意删除文案时，只改 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 里的 `--max-gone`           |
| 界面截图             | `node scripts/ui-shot.mjs`。脚本开头写了预览服务和账号参数                                                                               |
| 后端规则或响应       | `pnpm --dir server test`，以及 `pnpm --dir server test:contract`（需要 PostgreSQL）。改了已加载的 `server/src` 后重启不用 watch 起的进程 |
| Java 或桥接          | `gradlew.bat :app:testDebugUnitTest`。出包或资源变更再跑 `gradlew.bat :app:assembleDebug`                                                |
| 仓库级冒烟           | `node scripts/smoke-check.js`                                                                                                            |

模拟器和真机用 `pwsh -File scripts\emu.ps1`，子命令写在脚本顶部。设备连不上后端时，先读 `server/src/dev/adb-reverse.ts` 开头。

WebView 文字不一定出现在无障碍树里。点击回归用坐标，并保留截图。扫码回归用 `node scripts/decode-shot.js` 检查真实截图像素。

动效全部静止时，先跑 `pwsh -File scripts\emu.ps1 motion check`。三个动画 scale 都为 1 之后，再改代码。

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
