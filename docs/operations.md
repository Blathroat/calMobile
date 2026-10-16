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

应用包里的接口地址来自 `APP_API_BASE`（`server/.env`，进程里已有的同名变量优先）。没配时是 `http://127.0.0.1:<PORT>/api/v1`。报名站不读它，接口仍是相对的 `/api/v1`。明文流量和混合内容只在这个地址是 `http` 时打开。改地址后要重新构建 APK。

包名默认 `com.blathroat.calmobile`。Java 源码仍在 `com.example.calmobile`。调试包和正式包都用这个包名。手机上已经装过 `com.example.calmobile` 的，是另一个应用，要先卸掉。

`./gradlew :app:assembleDebug` 使用当前这份配置，不要求公网地址或签名。`./gradlew :app:assembleRelease` 会拒绝：地址不是公网 https、包名是 `com.example`、签名四项缺一或密钥文件不存在。

推送到 `master` 的合并提交在 CI 成功之后，`.github/workflows/release.yml` 按这次推送的路径发布。普通提交跳过发布和部署。功能分支和拉取请求不发布。会触发发布、部署或页面同步的改动走 PR，用合并提交合入，不要直接推到 `master`。

`versionCode` 是这个工作流自己的运行编号，`versionName` 是 `0.1.` 加同一个编号，标签是 `v0.1.<编号>`。只有这次真的发布 APK 才占用这个编号建 Release，中间跳过的运行不会建标签，编号可以不连续。删掉或换掉这个工作流文件会让编号从 1 重新计。

路径归类在 `scripts/release-scope.mjs`。CI 在 push 时记下 `before..after` 的文件清单，Release 读取它：

- 原生外壳（`app/src/main`、`app/build.gradle`、Gradle、`scripts/client-target.mjs`）发布 APK。`client-target.mjs` 同时同步应用页面。
- 服务端运行时代码、依赖锁、`deploy/`、`scripts/remote-release.sh`、`scripts/sync-production-env.mjs` 部署并重启。
- 只进应用页面包的源（例如 `web/src/pages/HomePage.vue`、`web/src/main.ts`、`web/vite.config.ts`、`web/release-manifest.mjs`）同步 `web/dist` 到 `/app/`，不发 APK，不重启。
- 报名站专有源（`web/src/join/`、`web/join.html`、`web/vite.join.config.ts`、`server/scripts/build-join.ts`）只同步 `web/dist-join`，不重启。服务按请求读文件。
- 两边都会打进去的 `web/src`（文案、外壳、组件，以及报名站用到的页面）两份一起同步。同步的是构建产物，不是源文件。
- `server/src/domain/answer-document.ts` 重启服务，并同步两份页面。
- 文档、测试、`server/src/dev/` 不触发。

没把 `DEPLOY_ENABLED` 设成 `true` 时，只有 APK 会发布；页面、报名站和服务端都不同步。设成 `true`，并且配了 `DEPLOY_HOST`、`DEPLOY_USER` 和 `DEPLOY_SSH_KEY` 之后：需要重启的那次把 `server/dist`、`server/package.json`、`server/pnpm-lock.yaml` 放到 `DEPLOY_PATH`（默认 `/opt/calmobile`），并带上这次构建出来的 `web/dist-join`；应用页面有改动时再同步 `web/dist`。只改页面时只同步对应目录，不安装依赖、不迁移、不重启。报名站在部署目录的 `web/dist-join`，应用页面在 `web/dist`，都和 `server/dist` 同级。`web/src` 不上传。`web/src/i18n/strings.ts` 在构建时打进这两份产物的脚本里，服务器上没有这个源文件。同步用 `rsync --delete`，会换掉对应目录里的旧脚本。需要重启时，同步前把现有 `server/dist` 复制为 `server/dist.prev`，然后补齐 `/etc/calmobile.env`，在服务器上执行 `pnpm install --frozen-lockfile --prod` 和 `pnpm db:migrate:prod`，再重启 `calmobile.service`。

应用页面打进 APK 一份。正式包打开接口所在源的 `/app/index.html`，WebView 把这个路径拦截到本机快照，页面切换不访问网络。快照没有，或不是当前 `versionCode`，就用包内那份。首屏出来之后才后台拉取 `/app/release.json`；有新版本才下到待用目录，下次冷启动再换上，使用中不重载。调试包（接口是 http）不热更新。改 `APP_API_BASE` 仍要重新构建 APK：文档源写在外壳里。页面包在同步时用同一个 `APP_API_BASE` 构建。

环境文件只补还没有的键。服务器上已有的非空值不会被覆盖，文件里多出来的键会保留。空的密钥不会写入。`JWT_SECRET`、`TOTP_SECRET_KEY`、`DB_PASSWORD`、`MAIL_SMTP_PASSWORD`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL` 在服务器和 GitHub Secrets 里都没有时，部署失败，也不会把空值写进去。要改一个已经存在的值，直接改服务器上的 `/etc/calmobile.env`。只改同名的 GitHub Secret 或 Variable 不会替换它。固定的非密钥项在 `deploy/production.env`。域名、数据库主机和发件人地址放在 GitHub Variables。服务器地址不要放进 Variables：变量值会原样写进 Actions 日志，仓库一旦公开，日志也公开。地址放在 Secret `DEPLOY_HOST`，日志里会打成星号。口令、签名和 SSH 私钥同样只放 Secrets，不进仓库。

进程里已有的非空变量仍然优先于 `server/.env`。生产单元用 `EnvironmentFile=/etc/calmobile.env` 把这份文件注进进程。部署目录里不要再放一份开发用的 `.env`。上传目录用绝对路径，放在部署目录外面。

服务器上要已经有 `calmobile.service`。部署不会创建它。单元里要有这三处：

```
WorkingDirectory=/opt/calmobile/server
EnvironmentFile=/etc/calmobile.env
ExecStart=/usr/bin/node dist/index.js --production
```

`WorkingDirectory` 跟实际的 `DEPLOY_PATH` 走。部署账号对 `DEPLOY_PATH` 可写；不是 root 时还要能免密 `sudo`，用来安装环境文件和重启。服务器上的 Node 要满足 `engines`，并且部署账号的 `PATH` 里有 `node` 和 `pnpm`。失败时旧进程继续跑，磁盘上的 `server/dist` 可能已经换成新的，上一份在 `server/dist.prev`。数据库要另外从备份恢复。

正式签名只生成一次，密钥文件自己保管。丢了就不能给已经安装的 `com.blathroat.calmobile` 发更新。

```
keytool -genkeypair -v -keystore calmobile-release.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

把 `calmobile-release.jks` 做一次 base64，放进 GitHub Secret `ANDROID_KEYSTORE_BASE64`。口令和别名放进下面的 Secrets。不要把密钥文件或口令提交进仓库。

GitHub Variables：`APP_API_BASE`（`https://域名/api/v1`）、`PUBLIC_BASE_URL`（`https://域名`）、`PRIVACY_POLICY_URL`。要部署服务器时再加 `DEPLOY_ENABLED`（`true` 才部署）、`DEPLOY_USER`、`DEPLOY_PATH`，以及实际用到的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_SSL`、`MAIL_SMTP_HOST`、`MAIL_SMTP_PORT`、`MAIL_SMTP_SECURE`、`MAIL_SMTP_TLS_REJECT_UNAUTHORIZED`、`MAIL_SMTP_USER`、`MAIL_FROM_ADDRESS`、`MAIL_REPLY_TO`、`FORCE_HTTPS`、`HSTS_MAX_AGE`、`UPLOAD_DIR`、`MEDIA_BASE_URL`、`UPLOAD_MAX_MB`、`JWT_EXPIRES_IN`、`REFRESH_TOKEN_TTL`。这些值会出现在 Actions 日志里，不要把服务器地址或口令写进来。

GitHub Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。要部署服务器时再加 `DEPLOY_HOST`、`DEPLOY_SSH_KEY`、`JWT_SECRET`、`TOTP_SECRET_KEY`、`DB_PASSWORD`、`MAIL_SMTP_PASSWORD`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL`。

新增一个要下发的键时，非密钥的固定项写进 `deploy/production.env`；密钥或按机器变化的值写进 `scripts/sync-production-env.mjs` 的 `SERVER_VALUE_KEYS`，并在 `release.yml` 的部署步骤里传入。下一次部署只会把它补进还没有这个键的服务器。

发布前下面每一项都成立：

1. `pnpm start` 的自检通过。生产不跑 `pnpm db:seed`。自检会拒绝启动的项和只警告的项，见 [`server/README.md`](../server/README.md) 的模式表。
2. 反代只暴露 443，并送出 `X-Forwarded-Proto` 与 `X-Forwarded-For`。服务端设 `TRUST_PROXY=1`。
3. 确认 https 全站可用之后，再开 `FORCE_HTTPS` 和长 `HSTS_MAX_AGE`。
4. `CORS_ORIGIN` 写成真实来源。
5. 状态页保持关闭，或在反代上加 Basic Auth 并只允许内网访问。公网探活只用 `/ping`。
6. `JWT_SECRET` 与 `TOTP_SECRET_KEY` 各自至少 32 个随机字符。数据库口令不是示例值。`MAIL_FROM_ADDRESS` 已显式配置。生产发信走托管中继，SPF 只 include 中继方，不把源站地址写进 DNS。中继的登录口令放在 Secret `MAIL_SMTP_PASSWORD`。本地开发用 Mailpit。
7. Node 版本满足 `engines`。在 `server/` 执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，再执行 `pnpm db:migrate:prod`，迁移完成后再切流量。
8. 数据库时区是 `Asia/Shanghai`。原因写在仓库根 `docker-compose.yml`。备份和恢复演练已经做过。
9. `client_max_body_size` 盖住视频单文件上限。视频默认 50MB 时至少写 `64m`。头像那一道传输硬顶盖不住视频。上传目录和开关见 `server/.env.example`。存满之后的产品行为见 [`product.md`](product.md)。
10. 注册页有收集说明。`PRIVACY_POLICY_URL` 是 https 政策地址。当前邮件只有验证码，没有营销信。
11. 外壳有改动时，正式包用 `./gradlew :app:assembleRelease`，或由上面的 Release 工作流在 `master` 的合并提交通过 CI 后构建。`APP_API_BASE` 是与 `PUBLIC_BASE_URL` 同一个源的 `https://域名/api/v1`。包名是 `com.blathroat.calmobile`。签名四项指向正式密钥。`ENABLE_WEB=true`，`web/dist-join` 已构建，并且 `web/dist` 已放到站点的 `/app/`。
