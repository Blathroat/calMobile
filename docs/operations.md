# 构建、测试与上线

本文件是跨模块的验证和上线步骤。后端启动、模式差异和响应约定见 [`server/README.md`](../server/README.md)。环境变量以 `server/.env.example` 的注释为准。Node 版本以 `server/package.json` 和 `web/package.json` 的 `engines` 为准。

前端 `vue-tsc` 停在 TypeScript 6（`web/package.json` 的 `typescript`）。当前 Vue 类型检查器用不上 TypeScript 7 的原生编译入口。后端使用 TypeScript 7。升级时保留 `.vue` 类型检查。

## 按改动验证

改完后，下表里对应命令的退出码为 0。

| 改动 | 命令 |
|---|---|
| Vue 页面、组件、样式、界面文案 | `pnpm --dir web typecheck`、`pnpm --dir web lint`、`pnpm --dir web fmt:check`、`pnpm --dir web test`、`pnpm --dir web build`（改了报名站页面再跑 `pnpm --dir web build:join`）。打 APK 时 `preBuild` 把 `web/dist` 同步到 WebView 资源 |
| 路由与加载 | `pnpm --dir web test` |
| 后端规则或响应 | `pnpm --dir server lint`、`pnpm --dir server fmt:check`、`pnpm --dir server test`，以及 `pnpm --dir server test:contract`（需要 PostgreSQL）。`pnpm --dir server test` 同时跑发布脚本的 Node 测试。改了已加载的 `server/src` 后重启不用 watch 起的进程 |
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

### 发布链路

推送到 `master` 的合并提交在 CI 成功之后，`.github/workflows/release.yml` 按这次推送的路径发布。普通提交只跑 CI，不发布；功能分支和拉取请求不发布。会触发发布或更新的改动走 PR，用合并提交合入，不要直接推到 `master`。合入前要等该拉取请求自己的 CI 成功。检查还在跑或失败时不要合并。合并之后 `master` 上还会再跑一次推送 CI，那一次才决定自动 Release。

一次 Release 产出两件东西：

- GitHub Releases 上的 APK，标签 `v0.1.<运行编号>`；
- 公开 npm 上的运行时包 `calmobile-server@0.1.<运行编号>`。

运行时包里有 `server/dist`、`web/dist`、`web/dist-join`、服务端依赖清单和更新器脚本。服务器解压后 `server/` 与 `web/` 同级，服务端据此找到页面产物。`web/src` 和 `server/src` 不进包；界面文案在构建时已经打进两份页面产物的脚本里。

路径归类在 [`scripts/release-scope.mjs`](../scripts/release-scope.mjs)。CI 在 push 时记下 `before..after` 的文件清单，Release 读取它：

- 原生外壳（`app/src/main`、`app/build.gradle`、Gradle、`scripts/client-target.mjs`）发布 APK。
- 服务端运行时代码、依赖锁、`deploy/`、`scripts/runtime-bundle.mjs`、`scripts/sync-production-env.mjs` 发布运行时包。
- 只进应用页面包的源（例如 `web/src/pages/HomePage.vue`、`web/src/main.ts`、`web/vite.config.ts`、`web/release-manifest.mjs`）、报名站专有源（`web/src/join/`、`web/join.html`、`web/vite.join.config.ts`、`server/scripts/build-join.ts`）、两边共用的 `web/src` 都发布运行时包。
- `server/src/domain/answer-document.ts` 发布运行时包。
- 文档、测试、`server/src/dev/` 不触发。

运行时包总是整包发布，不按目录拆分：任一类改动命中就发一次，包内同时带服务端和两份页面。发 APK 时也会发布运行时包——APK 里的页面和服务器上的 `/app/` 页面都带同一个 `0.1.<运行编号>` 版本号，不同步会让应用内更新检查一直认为有更新。只有四类改动都不命中时整次跳过。

`versionCode` 是这个工作流自己的运行编号，`versionName` 是 `0.1.` 加同一个编号，APK 标签是 `v0.1.<编号>`，npm 包版本也是 `0.1.<编号>`。中间跳过的运行不发布，编号可以不连续。删掉或换掉这个工作流文件会让编号从 1 重新计。

路径不需要发布时，Release 仍然成功，但 APK 和运行时包都跳过，也不建标签。手动强制发布是另一次运行。两次各占一个运行编号，所以标签和包版本可以跳号。

已经在 `master` 上、并且这次提交的 CI 已经成功时，可以在 Actions 里手动运行 Release，强制发布当时的 `master`。四个开关默认都开：发 APK、服务端、应用页面、报名站。`server` / `app` / `join` 任选其一就会发布完整运行时包，包内不会只带其中一部分。发 APK 时总会发布运行时包。强制发布不看这次推送改了哪些文件，构建的是当前提交。功能分支不能强制发布。检查还在跑、或者还没有成功的 master CI 时，强制发布会拒绝。撤回合并再发布会发布撤回之后的旧代码，不要用撤回来补发。

npm 上同一个版本已经存在时，发布步骤会跳过，不会让重跑失败。npm 发布带 provenance，仓库和包都公开。

### 服务器更新

服务器不再由 CI 通过 SSH 推送，而是由 systemd timer 从 npm 拉取：

```
/opt/calmobile/current -> releases/0.1.<编号>
/opt/calmobile/releases/0.1.<编号>/{server,web}
/opt/calmobile/releases/0.1.<编号>/deploy/、scripts/
/opt/calmobile/state/{pin,update.lock,cache/}
```

生产单元里要有这三处：

```
WorkingDirectory=/opt/calmobile/current/server
EnvironmentFile=/etc/calmobile.env
ExecStart=/usr/bin/node dist/index.js --production
```

更新器是 `/usr/local/lib/calmobile/calmobile-update.mjs`，随运行时包一起发布；一次成功切换后会把自己更新到新版本。`calmobile-update.timer` 每 5 分钟触发一次 `calmobile-update.service`，开机 3 分钟后第一次。配置从 `/etc/calmobile-update.json` 读，样例见仓库 `deploy/calmobile-update.json.example`；`CALMOBILE_REGISTRY`、`CALMOBILE_PACKAGE` 等环境变量可以覆盖。国内网络访问 npm 官方源慢时，把 `registry` 改成可达的镜像；镜像同步有延迟，更新会晚一点。

手动操作：

```
node /usr/local/lib/calmobile/calmobile-update.mjs --check
sudo systemctl start calmobile-update.service
journalctl -u calmobile-update -n 100
node /usr/local/lib/calmobile/calmobile-update.mjs --rollback
node /usr/local/lib/calmobile/calmobile-update.mjs --unpin
```

一次更新依次做：校验 npm 元数据和 tarball 完整性 → 解压到 `releases/.tmp-*` → `pnpm install --frozen-lockfile --prod` → 补齐 `/etc/calmobile.env` 缺失的键 → 用新版本代码跑迁移 → 原子切换 `current` → 重启 `calmobile.service` → 轮询 `/ping`。成功后删除超出 `keep`（默认 3）的旧版本和旧缓存。服务端的离线 IP 归属地库（`ip2region-ts`）随依赖一起装进版本目录，数据文件在包里，不需要额外环境变量或手工放文件；解析失败只让最近登录地区为空，不影响登录。

失败时不会把线上搞挂：

- 下载、校验、依赖安装、环境文件合并或迁移失败：不切换，旧版本继续服务，timer 下次重试。
- 切换后启动失败或 `/ping` 超过 30 秒不返回 200：自动切回上一版本、重启并写 `state/pin`，需要修好之后执行 `--unpin`（或 `--update --force`）恢复自动更新。
- 回滚只换程序，不撤销数据库迁移。迁移只追加，旧版本可以读新库；高风险迁移前另外备份数据库。
- 手动 `--rollback` 同样会写 pin，避免 5 分钟后被自动更新拉回坏版本。

服务器上要能不用密码执行 `sudo`（安装环境文件、执行迁移、重启服务），Node 要满足 `engines`，`pnpm` 和 `tar` 在 `PATH` 里，运行更新的账号对 `/opt/calmobile` 可写。磁盘至少留 `minFreeMb`（默认 512 MB）。

首次从 SSH 部署切换到 npm：

1. 等一次 Release 成功，确认 npm 上已经有 `calmobile-server@0.1.<编号>`。
2. 把 `deploy/calmobile-update.mjs` 放到 `/usr/local/lib/calmobile/calmobile-update.mjs`，把 `deploy/calmobile-update.json.example` 复制成 `/etc/calmobile-update.json`。
3. 运行 `node /usr/local/lib/calmobile/calmobile-update.mjs --update`：建立 `releases/0.1.<编号>`、`current`，完成依赖安装和迁移。此时 `calmobile.service` 还指向旧目录，这一步只是重启旧服务，不影响访问。
4. 把 `calmobile.service` 的 `WorkingDirectory` 改成 `/opt/calmobile/current/server`，`systemctl daemon-reload` 后重启。
5. 安装 `deploy/calmobile-update.service` 与 `deploy/calmobile-update.timer`，`systemctl enable --now calmobile-update.timer`。
6. 确认 `/ping`、`/`、`/app/index.html`、`/app/release.json`、`/join` 都正常后，删除旧的 `/opt/calmobile/server`、`/opt/calmobile/web` 和 `dist.prev`。
7. 在 GitHub 删除不再使用的 `DEPLOY_*` Secrets / Variables。

### 环境文件

进程里已有的非空变量仍然优先于 `server/.env`。生产单元用 `EnvironmentFile=/etc/calmobile.env` 把这份文件注进进程。部署目录里不要再放一份开发用的 `.env`。上传目录用绝对路径，放在部署目录外面，不随版本切换。

`/etc/calmobile.env` 是服务器运行配置的唯一来源。更新器只把运行时包里 `deploy/production.env` 有、而服务器上没有的键补进去；服务器上已有的非空值不覆盖，文件里多出来的键保留，空的密钥不写入。`JWT_SECRET`、`TOTP_SECRET_KEY`、`DB_PASSWORD`、`MAIL_SMTP_PASSWORD`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL` 缺失时更新器在合并环境文件的阶段就中止，不会切换版本。要改一个已经存在的值，直接改服务器上的 `/etc/calmobile.env` 并重启服务。GitHub Variables 不再写进服务器；数据库、邮件等按机器变化的值只维护在服务器上。

新增一个键时：非密钥的固定项写进 `deploy/production.env`，下一次更新自动补进还没有它的服务器；密钥或必须按机器填的值直接写进服务器 `/etc/calmobile.env`。缺了它会让生产自检拒绝启动的必填密钥，还要加进 `scripts/sync-production-env.mjs` 的 `REQUIRED_SERVER_SECRETS`，更新器会在切换版本前拦住。

应用页面打进 APK 一份。正式包打开接口所在源的 `/app/index.html`，WebView 把这个路径拦截到本机快照，页面切换不访问网络。快照没有，或不是当前 `versionCode`，就用包内那份。首屏出来之后才后台拉取 `/app/release.json`；有新版本才下到待用目录，下次冷启动再换上，使用中不重载。调试包（接口是 http）不热更新。改 `APP_API_BASE` 仍要重新构建 APK：文档源写在外壳里。运行时包里的页面用同一个 `APP_API_BASE` 构建。

### 反向代理、证书与通行密钥

正式签名只生成一次，密钥文件自己保管。丢了就不能给已经安装的 `com.blathroat.calmobile` 发更新。

```
keytool -genkeypair -v -keystore calmobile-release.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

把 `calmobile-release.jks` 做一次 base64，放进 GitHub Secret `ANDROID_KEYSTORE_BASE64`。口令和别名放进下面的 Secrets。不要把密钥文件或口令提交进仓库。

**通行密钥在 App 内工作还需要两件部署侧的事**：① 把 App 的签名证书哈希加进 `WEBAUTHN_ORIGINS`（形如 `android:apk-key-hash:<base64url>`，用 `keytool -list -v -keystore <keystore> -alias <alias>` 取 SHA-256 后按 base64url 编码，去掉填充）。整串原样粘进去，服务端按 43 位 base64url 的形状校验，写错的条目会被丢掉；② 在 `https://<域名>/.well-known/assetlinks.json` 声明应用与域名的关联（`package_name` 用 `ANDROID_APPLICATION_ID`，`sha256_cert_fingerprints` 用同一份证书摘要），系统凭据提供方据此确认「这个应用可以代表这个域名使用通行密钥」。两个来源都要列（写着 WEBAUTHN_ORIGINS 就等于替换掉默认那组，所以 `https://<域名>` 那一条也别漏）。浏览器里使用通行密钥不需要这两步。

**assetlinks.json 怎么放**：反代在这个仓库外面，服务器上按静态文件提供 —— 文件放 `/var/www/calmobile/.well-known/assetlinks.json`，nginx 的 443 段加一条精确匹配：

```nginx
location = /.well-known/assetlinks.json {
    default_type application/json;
    alias /var/www/calmobile/.well-known/assetlinks.json;
}
```

`content-type` 必须是 `application/json`，系统凭据提供方只认根路径这一个地址；改完记得 `nginx -t` 再 reload。这份文件不随 npm 包发布，换证书或换包名要手动覆盖。

通行密钥与更新检查还会读三个可选变量：`WEBAUTHN_RP_ID`（默认取 `PUBLIC_BASE_URL` 的主机名，**必须与用户实际打开页面的域名一致**，否则浏览器拒绝调用）、`WEBAUTHN_RP_NAME`、`WEBAUTHN_ORIGINS`（逗号分隔的完整来源，默认含 `PUBLIC_BASE_URL` 与本地 `http://localhost:<PORT>`；**App 内使用通行密钥时还必须加上 `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`**，否则系统凭据提供方发回的断言会因来源不符被拒）；下载源选 GitHub 仓库时可以配 `GITHUB_TOKEN` 提高 GitHub API 额度（不配也能用，只是每小时次数少）。语言包不随页面发布：它放在用户机器的本机存储里，由 `LANG_PACK_URLS` 指向的任意 https 地址下载（或用户在设置里选 JSON 文件安装）。报名站只有在默认名称非空、且这个名称写在 `LANG_PACK_URLS` 里时才用该语言，否则用中文。这些值直接写在服务器 `/etc/calmobile.env`，更新器只补缺失键，不改已有值；改已有值要直接改文件并重启。

### GitHub Variables 与 Secrets

GitHub Variables：`APP_API_BASE`（`https://域名/api/v1`）、`PUBLIC_BASE_URL`（`https://域名`）、`PRIVACY_POLICY_URL`、`LANG_PACK_DEFAULT`（默认语言包名称）、`LANG_PACK_URLS`（`名称=链接`，逗号或空白分开）。这些值会出现在 Actions 日志里，服务器地址、口令和私钥不要写进来。

GitHub Secrets：`NPM_TOKEN`（能发布 `calmobile-server` 的 npm automation token，允许绕过 2FA）、`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。

### 发布前检查

发布前下面每一项都成立：

1. `pnpm start` 的自检通过。生产不跑 `pnpm db:seed`。自检会拒绝启动的项和只警告的项，见 [`server/README.md`](../server/README.md) 的模式表。
2. 反代只暴露 443，并送出 `X-Forwarded-Proto` 与 `X-Forwarded-For`。服务端设 `TRUST_PROXY=1`。
3. 确认 https 全站可用之后，再开 `FORCE_HTTPS` 和长 `HSTS_MAX_AGE`。
4. `CORS_ORIGIN` 写成真实来源。
5. 状态页保持关闭，或在反代上加 Basic Auth 并只允许内网访问。公网探活只用 `/ping`。
6. `JWT_SECRET` 与 `TOTP_SECRET_KEY` 各自至少 32 个随机字符。数据库口令不是示例值。`MAIL_FROM_ADDRESS` 已显式配置。生产发信走托管中继，SPF 只 include 中继方，不把源站地址写进 DNS。中继的登录口令放在服务器 `/etc/calmobile.env`。本地开发用 Mailpit。
7. 服务器上的 Node 满足 `engines`，`pnpm`、`tar` 在 `PATH` 里，运行更新的账号能免密 `sudo`。首次切换到 npm 更新时按上面的步骤完成一次 `--update`，确认迁移和重启成功。
8. 数据库时区是 `Asia/Shanghai`。原因写在仓库根 `docker-compose.yml`。备份和恢复演练已经做过。
9. `client_max_body_size` 盖住视频单文件上限。视频默认 50MB 时至少写 `64m`。头像那一道传输硬顶盖不住视频。上传目录和开关见 `server/.env.example`。存满之后的产品行为见 [`product.md`](product.md)。
10. 注册页有收集说明。`PRIVACY_POLICY_URL` 是 https 政策地址。当前邮件只有验证码，没有营销信。
11. 外壳有改动时，正式包用 `./gradlew :app:assembleRelease`，或由上面的 Release 工作流在 `master` 的合并提交通过 CI 后构建。`APP_API_BASE` 是与 `PUBLIC_BASE_URL` 同一个源的 `https://域名/api/v1`。包名是 `com.blathroat.calmobile`。签名四项指向正式密钥。`ENABLE_WEB=true`，运行时包里的 `web/dist-join` 已由更新器放到当前版本目录。
