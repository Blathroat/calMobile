# 构建、测试与上线

本文件是跨模块的验证和上线步骤。后端启动、模式差异和响应约定见 [`server/README.md`](../server/README.md)。环境变量以 `server/.env.example` 的注释为准；运行期 PWA/标题/图标品牌见 `server/.env.example` 的「运行时品牌」，构建期默认值见 `web/.env.example`。Node 版本以 `server/package.json` 和 `web/package.json` 的 `engines` 为准。

前端 `vue-tsc` 停在 TypeScript 6（`web/package.json` 的 `typescript`）。当前 Vue 类型检查器用不上 TypeScript 7 的原生编译入口。后端使用 TypeScript 7。升级时保留 `.vue` 类型检查。

## 按改动验证

改完后，下表里对应命令的退出码为 0。

| 改动 | 命令 |
|---|---|
| Vue 页面、组件、样式、界面文案 | `pnpm --dir web typecheck`、`pnpm --dir web lint`、`pnpm --dir web fmt:check`、`pnpm --dir web test`、`pnpm --dir web build`（改了报名站页面再跑 `pnpm --dir web build:join`）。打 APK 时 `preBuild` 把 `web/dist` 同步到 WebView 资源 |
| iPhone / PWA 与图标（`web/pwa-build.mjs`、安装引导、`web/public/` 图标、`scripts/build-icons.mjs`） | 上面的前端命令，另跑 `node scripts/build-icons.test.mjs`；`pnpm --dir web build` 之后确认 `web/dist/manifest.webmanifest`、`web/dist/sw.js`、`web/dist/favicon.ico`、`web/dist/icons/` 都已生成，`web/dist/sw.js` 的预缓存列表不含 `release.json` 与 `sw.js`。Vite 的 `check-page-bundle` 插件在每次产物写完后扫描，页面包写死实例域名时构建失败。改 APK 图标或 `app/build.gradle` 再跑 `gradlew.bat :app:assembleDebug` |
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

应用包里的接口地址来自 `APP_API_BASE`（`server/.env`，进程里已有的同名变量优先）。没配时是 `http://127.0.0.1:<PORT>/api/v1`。它只决定 APK 外壳加载哪个源的 `/app/index.html`、开发代理目标、明文/混合内容和 APK 页面源；页面包本身一律用相对 `/api/v1`，同一份 `web/dist` 可部署到任意 `PUBLIC_BASE_URL`。报名站不读它，接口仍是相对的 `/api/v1`。改 APK 指向的实例仍要重新构建 APK。

包名默认 `com.blathroat.calmobile`。Java 源码仍在 `com.example.calmobile`。调试包和正式包都用这个包名。手机上已经装过 `com.example.calmobile` 的，是另一个应用，要先卸掉。

`./gradlew :app:assembleDebug` 使用当前这份配置，不要求公网地址或签名。`./gradlew :app:assembleRelease` 会拒绝：地址不是公网 https、包名是 `com.example`、签名四项缺一或密钥文件不存在。

### PWA 与 iPhone 主屏幕

iPhone 没有 APK，安装文件是 `web/dist` 里随页面一起发布的静态文件，由服务端的 `/app/` 托管。固定文件名一律 `Cache-Control: no-cache`：

| 路径 | Content-Type | 缓存 |
|---|---|---|
| `/app/manifest.webmanifest` | `application/manifest+json; charset=utf-8` | `no-cache` |
| `/app/sw.js` | `text/javascript; charset=utf-8` | `no-cache` |
| `/app/favicon.ico` | `image/x-icon` | `no-cache` |
| `/app/icons/*` | 按扩展名（PNG 为 `image/png`） | `no-cache` |
| `/app/assets/*` | 按扩展名 | `public, max-age=31536000, immutable` |

根路径 `/favicon.ico` 也从 `web/dist/favicon.ico` 转发，供浏览器默认的站点图标请求使用；它和应用内的 `/app/favicon.ico` 是同一份构建产物。

构建产物里带一套默认安装信息：`web/pwa-build.mjs` 在构建时从 `web/src/i18n/zh.json` 生成 `manifest.webmanifest`、页面标题与 meta，`PWA_*` 构建变量可覆盖默认值。部署后，服务器启动时还会读 `/etc/calmobile.env` 的同名变量并生成实例专属页面层：改 `manifest`、`index.html` 标题/meta、`join.html` 标题与 PWA 图标，并重算 `release.json`。所以同一份 `calmobile-server` 可以用在不同 `PUBLIC_BASE_URL` 下，不需要按实例重新构建 `web/dist`。

运行时品牌变量（不配就沿用构建期默认值）：

| 变量 | 作用 |
|---|---|
| `PWA_APP_NAME` | `manifest.name` 与应用页标题后缀（页面标题是「品牌 · 应用名」） |
| `PWA_APP_SHORT_NAME` | `manifest.short_name`、`apple-mobile-web-app-title` |
| `PWA_APP_DESCRIPTION` | `manifest.description`、`meta name="description"` |
| `APP_TITLE` | 应用页完整标题覆盖；设置后不再拼品牌前缀 |
| `JOIN_TITLE` | 报名站页签标题 |
| `PWA_LANG` / `PWA_THEME_COLOR` / `PWA_THEME_COLOR_DARK` / `PWA_BACKGROUND_COLOR` | manifest 语言、主题色与背景色 |
| `APP_ICON` / `APP_ICON_BACKGROUND` / `APP_ICON_TRANSPARENT` | 运行时生成 PWA/favicon 图标；透明模式同时影响 Android 构建 |
| `PWA_ICON_DIR` | 直接使用一套预生成的 `favicon.ico` + `icons/*`，与 `APP_ICON` 二选一 |

没有品牌变量时服务器直接托管构建产物，零额外开销；有品牌变量时启动会复制一份临时页面层、改完并重算 `release.json`，进程退出时清理。单个品牌项（标题、manifest、图标、SW 缓存名）失败只回退该项并打 warning，`release.json` 生成失败才整体回退静态页面。`web/dist` 本身不被修改。改这些变量要重启服务；Android 热更新会按新的 `release.json` 校验并拉取新页面。构建期 `PWA_*` 仍给 APK 和默认页面兜底，写在构建机的 `web/.env` / `.env.local` 或构建进程环境里。

图标生成和 `APP_ICON` 配置见下面的「应用图标」。主屏幕名称与图标在安装时写进系统；改 `PWA_*`、`APP_ICON` 或 `JOIN_TITLE` 后要重启服务，并让用户删除旧主屏幕图标后重新「添加到主屏幕」才会看到新名称/图标。

发布后确认（把 `<域名>` 换成实际域名）：

```bash
curl -s -D - -o /dev/null https://<域名>/app/manifest.webmanifest   # 200、application/manifest+json、no-cache
curl -s -D - -o /dev/null https://<域名>/app/sw.js                  # 200、text/javascript、no-cache
curl -s -D - -o /dev/null https://<域名>/app/favicon.ico            # 200、image/x-icon、no-cache
curl -s -D - -o /dev/null https://<域名>/favicon.ico                # 200、image/x-icon、no-cache
curl -s -D - -o /dev/null https://<域名>/app/icons/icon-192.png     # 200、image/png、no-cache
curl -s https://<域名>/app/manifest.webmanifest | jq '{name,short_name,start_url,scope,display}'
# 预缓存列表里应只有页面壳：没有 release.json 与 sw.js
curl -s https://<域名>/app/sw.js | sed -n 's/^const PRECACHE = //p'
```

iPhone 真机验收（Safari，或从主屏幕打开）：

1. Safari 打开 `/app/`：首页出现一次「安装到主屏幕」引导，关掉后刷新不再自动出现；设置页仍有「安装到主屏幕」入口，能重新打开同一份说明；用微信等非 Safari 浏览器打开时，说明提示先换到 Safari。
2. 分享 →「添加到主屏幕」：名称与图标正确；从主屏幕打开是独立窗口（没有 Safari 地址栏），首页月历与展会能正常加载。第一次打开可能需要重新登录，登录后数据正常。
3. 报名站（`/e/…`）在 iPhone 上：顶部显示安装引导而不是下载条，按钮打开同一份说明，「打开完整应用」能跳到 `/app/`。
4. 详情页「加入日历」生成 `.ics` 并通过分享面板存到「文件」，点开后能加入系统日历；页面上没有「移出日历」。
5. 头像、封面、简介图片能选图并上传；语言包与协议 Markdown 能选文件；CSV、语言包底稿、二维码图片落成下载文件；分享走系统面板，退回复制时提示成功。
6. 核销页能用摄像头扫码；拒绝相机权限或没有摄像头时提示改用选图或手动输入。
7. 开飞行模式后从主屏幕重新打开：页面壳仍能打开，数据请求失败有可见提示（没有离线数据）；恢复网络后重新打开能加载新页面。
8. 设置页没有「应用更新」组；换语言包后主屏幕名称与图标不变。

### 应用图标

网站 favicon、PWA 主屏幕图标、Apple 主屏幕图标和 APK 启动图标共用一张源图，避免四处各放一份后改漏。构建期和服务器运行期读同一组变量：构建时生成页面/APK 的默认图标，服务器启动时可以按实例再生成一套 PWA/favicon 图标（见上面的「PWA 与 iPhone 主屏幕」）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_ICON` | `web/public/icons/icon-1024.png` | 方形 PNG；构建时相对仓库根，运行时相对包根或绝对路径 |
| `APP_ICON_BACKGROUND` | `#41707e` | 十六进制底色；maskable、Apple 主屏幕、Android 自适应图标留白用；需与 `APP_ICON` 或 `PWA_ICON_DIR` 一起配 |
| `APP_ICON_TRANSPARENT` | 空 | `1` 时生成透明图标；Android 侧不再生成 adaptive 图标；需与图标源一起配 |
| `PWA_ICON_DIR` | 空 | 服务器运行时直接使用预生成的 `favicon.ico` + `icons/*`（需含 192/512/1024/maskable/favicon-32/apple-180），与 `APP_ICON` 二选一 |

构建期写在构建机的 `server/.env` 或构建进程环境里（`web/.env` 不作为图标配置来源，避免网页和 APK 拿到不同源图）。运行时写在服务器 `/etc/calmobile.env`；两者同名时运行时优先。

生成范围：

| 目标 | 产物 |
|---|---|
| 网站 / PWA | `web/dist/favicon.ico`（16/32/48 三个 PNG 条目）、`web/dist/icons/icon-192.png`、`icon-512.png`、`icon-1024.png`、`maskable-512.png`、`favicon-32.png`、`apple-touch-icon-180.png` |
| Android 启动图标 | `app/build/generated/icons/res/mipmap-*/ic_launcher.png`、`ic_launcher_round.png`（mdpi 48 到 xxxhdpi 192） |
| Android 自适应 | `mipmap-anydpi-v26/ic_launcher.xml`、`ic_launcher_round.xml`、`mipmap-*/ic_launcher_foreground.png`（108～432）、`values/ic_launcher_background.xml`；`APP_ICON_TRANSPARENT=1` 时不生成 |

网页图标在 `pnpm --dir web build` 时由 `web/pwa-build.mjs` 调 `scripts/build-icons.mjs` 生成；Android 图标由 Gradle 的 `buildIcons` 任务在 `preBuild` 时生成。两者都走同一个纯 Node 脚本，没有额外图片工具依赖。

源图要求：

- 只支持 **8 位 RGB / RGBA、非隔行 PNG**；非方形会居中裁切。
- `web/public/icons/icon.svg` 只是设计源，不参与生成；改 SVG 后要先导出 1024 PNG，再替换默认源图或设置 `APP_ICON`。
- Android 自适应前景是透明底；源图自带不透明底色时，建议把 `APP_ICON_BACKGROUND` 设成同色，否则会看到一块方形底色。

改图标的完整流程：

```bash
# 不配就用默认源图；也可以写进构建机的 server/.env
export APP_ICON=/path/to/icon.png
export APP_ICON_BACKGROUND=#123456
pnpm --dir web build
./gradlew :app:assembleDebug        # 或 assembleRelease
```

只重新生成图片、不跑完整构建：

```bash
node scripts/build-icons.mjs
# 或只生成 Android 资源
APP_ICON=/path/to/icon.png node scripts/build-icons.mjs --target android
```

服务器运行时换图标不需要重建页面包：把 PNG 放到服务器（例如 `/etc/calmobile/icon.png`），在 `/etc/calmobile.env` 配 `APP_ICON=/etc/calmobile/icon.png`（透明图再加 `APP_ICON_TRANSPARENT=1`），重启服务即可；服务启动时生成 `/app/icons/*`、`/app/favicon.ico` 并重算 `release.json`。也可以改用 `PWA_ICON_DIR` 指向预生成的 `favicon.ico` + `icons/*`。

发布链路：

- 只改 `web/pwa-build.mjs`：发运行时包，不发 APK（页面热更新即可）。
- 改 `web/public/icons/`（源图）或 `scripts/build-icons.mjs`：按 [`scripts/release-scope.mjs`](../scripts/release-scope.mjs) 归类会发 APK，同时发运行时包，避免新装 APK 还是旧图标。
- 只改 `APP_ICON` / `APP_ICON_BACKGROUND` / `PWA_ICON_DIR` 环境变量或服务器上的图片文件时，release-scope 不会命中，也不需要发版；改服务器 `/etc/calmobile.env` 后重启服务即可。
- 主屏幕 / 桌面图标是安装时写进系统的快照：重新生成后，用户要删掉旧图标重新「添加到主屏幕」，或重装 APK，才会看到新图。

发布后检查：

```bash
curl -s -D - -o /dev/null https://<域名>/favicon.ico
curl -s -D - -o /dev/null https://<域名>/app/favicon.ico
curl -s -D - -o /dev/null https://<域名>/app/icons/icon-192.png
```

### 本机与 iPhone 本地验收

PWA 的安装、Service Worker 和摄像头都要求安全上下文：桌面 `127.0.0.1` 算安全上下文；iPhone 必须用 HTTPS（`http://<局域网 IP>` 不行）。按下面两条路测试，第一条快，第二条才能测到 iOS 专有行为。

**A. 桌面 Chrome 快速验收**

```bash
docker compose up -d
cd server
cp .env.example .env          # 首次
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev                      # 终端 A，http://127.0.0.1:3000
```

```bash
pnpm --dir web build          # 终端 B，从仓库根目录执行
```

Chrome 打开 `http://127.0.0.1:3000/app/`，用 `demo` / `exhibitor` / `user`（密码都是 `password`）验证三种角色。DevTools → Application 里可以看 Manifest、Service Workers、Cache Storage；Network 勾 Offline 后刷新可以验证页面壳离线。地址栏的安装按钮可以装到桌面。这里能验证 manifest、SW、API、选图/下载/CSV/ICS、通知权限、响应式布局；iOS 的独立窗口、安全区、HEIC/MOV、系统分享面板和主屏幕安装仍要 iPhone。

**B. iPhone 真机（cloudflared 临时 HTTPS，推荐）**

1. 先按 A 启动 Docker 和 `pnpm --dir server dev`，确认 `http://127.0.0.1:3000/ping` 正常。
2. 另开终端启动临时隧道：

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

记下输出的 `https://xxxx.trycloudflare.com`，下面用 `BASE` 表示它。

3. 用隧道地址重启后端；页面包用相对 `/api/v1`，不需要为隧道地址重新构建：

```bash
BASE=https://xxxx.trycloudflare.com
PUBLIC_BASE_URL="$BASE" TRUST_PROXY=1 pnpm --dir server dev
```

页面按方案 A 构建好的 `web/dist` 直接复用即可（本地 `vite dev` 才需要 `APP_API_BASE` 作为代理目标）。PowerShell 写法：

```powershell
$BASE = "https://xxxx.trycloudflare.com"
$env:PUBLIC_BASE_URL = "$BASE"
$env:TRUST_PROXY = "1"
pnpm --dir server dev
```

4. iPhone Safari 打开 `$BASE/app/`：首页应出现安装引导；分享 →「添加到主屏幕」后从主屏幕启动。按上面的真机验收清单勾一遍。

注意：

- 页面包不带域名；`PUBLIC_BASE_URL` 是**服务端运行期**变量，改了要重启后端。隧道地址变了不需要重新 `pnpm --dir web build`；如果另外构建 APK，APK 的 `APP_API_BASE` 才需要指向隧道源。
- 临时隧道域名每次启动都变；只做一次验收够用。要反复测试通行密钥（WebAuthn 的 RP ID 绑定域名）或让 iPhone 长期访问，用 cloudflared 命名隧道、ngrok 固定域名，或局域网 + mkcert/Caddy 的可信证书；换域名后已安装的主屏幕图标要删掉重加。
- 快速隧道被网络环境拦截时，可换 ngrok，或在局域网用 Caddy `tls internal` / mkcert 生成证书并让 iPhone 信任根证书；`http://` 下 Service Worker 不会注册，安装也会退化成普通书签。
- 验证离线：首次在线打开、等 SW 装好并刷新一次后，开飞行模式从主屏幕启动；页面壳应出现，数据请求失败要有可见提示；恢复网络后重新打开。
- 验证安装名/描述：服务器 `/etc/calmobile.env` 配 `PWA_APP_NAME` / `PWA_APP_SHORT_NAME` / `PWA_APP_DESCRIPTION` / `APP_TITLE` / `JOIN_TITLE` 后重启服务，重新添加到主屏幕；构建期 `PWA_*` 只是默认值。已安装的名称为系统快照，不会自动更新。

### 发布链路

推送到 `master` 的合并提交在 CI 成功之后，`.github/workflows/release.yml` 按这次推送的路径发布。普通提交只跑 CI，不发布；功能分支和拉取请求不发布。会触发发布或更新的改动走 PR，用合并提交合入，不要直接推到 `master`。合入前要等该拉取请求自己的 CI 成功。检查还在跑或失败时不要合并。合并之后 `master` 上还会再跑一次推送 CI，那一次才决定自动 Release。

一次 Release 产出两件东西：

- GitHub Releases 上的 APK，标签 `v0.1.<运行编号>`；
- 公开 npm 上的运行时包 `calmobile-server@0.1.<运行编号>`。

运行时包里有 `server/dist`（含页面壳副本 `server/dist/app-shell`、报名站副本 `server/dist/app-shell-join`）、`web/dist`、`web/dist-join`、`scripts/build-icons.mjs`、服务端依赖清单和更新器脚本。服务器解压后 `server/` 与 `web/` 同级；服务端优先读 `web/dist`、`web/dist-join`，缺失时分别读 `server/dist/app-shell`、`server/dist/app-shell-join`。配置了运行时品牌时，服务启动后会在临时目录生成实例页面层，`web/dist` 本身不改。`web/src` 和 `server/src` 不进包；界面文案在构建时已经打进两份页面产物的脚本里。

路径归类在 [`scripts/release-scope.mjs`](../scripts/release-scope.mjs)。CI 在 push 时记下 `before..after` 的文件清单，Release 读取它：

- 原生外壳（`app/src/main`、`app/build.gradle`、Gradle、`scripts/client-target.mjs`）发布 APK。
- 服务端运行时代码、依赖锁、`deploy/`、`scripts/runtime-bundle.mjs`、`scripts/sync-production-env.mjs`、`scripts/build-icons.mjs` 发布运行时包。
- 只进应用页面包的源（例如 `web/src/pages/HomePage.vue`、`web/src/main.ts`、`web/vite.config.ts`、`web/release-manifest.mjs`）、报名站专有源（`web/src/join/`、`web/join.html`、`web/vite.join.config.ts`、`server/scripts/build-join.ts`）、两边共用的 `web/src` 都发布运行时包。
- PWA 构建脚本与安装图标（`web/pwa-build.mjs`、`scripts/build-icons.mjs`、`web/public/`）两份页面构建都要用，发布运行时包；图标源图还会生成 APK 启动图标，所以 `scripts/build-icons.mjs` 与 `web/public/icons/` 的改动也发 APK。
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

**`current/web/dist` 不是缓存**：它是运行时包里 PWA 的 `/app/`、Android 热更新清单和 favicon 的来源。更新器只删除超出 `keep` 的旧版本目录，不碰当前版本的 `web/dist`；生产服务单元也不要在启动前删除它（样例见 [`deploy/calmobile.service`](../deploy/calmobile.service)）。如果旧单元里有 `ExecStartPre=rm -rf .../current/web/dist`，去掉。运行时包另带 `server/dist/app-shell` 与 `server/dist/app-shell-join` 副本，旧单元仍清掉 `web/dist` 或 `web/dist-join` 时服务端会自动退到对应副本，`/app/`、PWA、报名站和 Android 热更新不会消失；但清理构建产物仍是错误配置，先修单元再回滚临时方案。

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
4. 把 `calmobile.service` 的 `WorkingDirectory` 改成 `/opt/calmobile/current/server`，`systemctl daemon-reload` 后重启。生产单元样例见 [`deploy/calmobile.service`](../deploy/calmobile.service)（`User` / `Group` 按机器调整）：`/opt/calmobile/current/web/dist` 和 `web/dist-join` 是运行时包的一部分，PWA 的 `/app/`、Android 热更新清单、站点图标和报名站都从这里读，**不要在 `ExecStartPre` 里删除或清空它们**；旧单元里有这类清理命令时删掉，只保留入口存在性检查。运行时包同时带 `server/dist/app-shell`、`server/dist/app-shell-join` 副本，服务端在构建产物被清理时会退到它们，但应把单元修好而不是依赖副本。
5. 安装 `deploy/calmobile-update.service` 与 `deploy/calmobile-update.timer`，`systemctl enable --now calmobile-update.timer`。
6. 确认 `/ping`、`/`、`/app/index.html`、`/app/release.json`、`/join` 都正常后，删除旧的 `/opt/calmobile/server`、`/opt/calmobile/web` 和 `dist.prev`。
7. 在 GitHub 删除不再使用的 `DEPLOY_*` Secrets / Variables。

### 环境文件

进程里已有的非空变量仍然优先于 `server/.env`。生产单元用 `EnvironmentFile=/etc/calmobile.env` 把这份文件注进进程。部署目录里不要再放一份开发用的 `.env`。上传目录用绝对路径，放在部署目录外面，不随版本切换。

`/etc/calmobile.env` 是服务器运行配置的唯一来源。更新器只把运行时包里 `deploy/production.env` 有、而服务器上没有的键补进去；服务器上已有的非空值不覆盖，文件里多出来的键保留，空的密钥不写入。`JWT_SECRET`、`TOTP_SECRET_KEY`、`DB_PASSWORD`、`MAIL_SMTP_PASSWORD`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL` 缺失时更新器在合并环境文件的阶段就中止，不会切换版本。要改一个已经存在的值，直接改服务器上的 `/etc/calmobile.env` 并重启服务。GitHub Variables 不再写进服务器；数据库、邮件等按机器变化的值只维护在服务器上。

新增一个键时：非密钥的固定项写进 `deploy/production.env`，下一次更新自动补进还没有它的服务器；密钥或必须按机器填的值直接写进服务器 `/etc/calmobile.env`。缺了它会让生产自检拒绝启动的必填密钥，还要加进 `scripts/sync-production-env.mjs` 的 `REQUIRED_SERVER_SECRETS`，更新器会在切换版本前拦住。

应用页面打进 APK 一份。正式包打开接口所在源的 `/app/index.html`，WebView 把这个路径拦截到本机快照，页面切换不访问网络。快照没有，或不是当前 `versionCode`，就用包内那份。首屏出来之后才后台拉取 `/app/release.json`；有新版本才下到待用目录，下次冷启动再换上，使用中不重载。调试包（接口是 http）不热更新。页面包本身用相对 `/api/v1`，不含 `APP_API_BASE` 域名；`APP_API_BASE` 只决定 APK 外壳加载哪个源，因此 APK 仍按实例构建，但同一份运行时包里的 `web/dist` 不必按域名重建。

### 多实例部署

同一个 `calmobile-server@0.1.<编号>` 运行时包可以同时服务多个实例，不需要按域名重新构建 `web/dist` 或 `web/dist-join`：

- 页面包不含 API 域名。应用、PWA、报名站的接口和媒体都走相对 `/api/v1`、`/media/...`，由当前页面 origin 决定实际实例。反代必须把 `/app/`、`/api/`、`/media/` 放在同一个源下。
- 每个实例只改自己的 `/etc/calmobile.env`：`PUBLIC_BASE_URL`（分享链接、安装说明地址、canonical redirect、WebAuthn 默认 RP/origin）、数据库、邮件、`LANG_PACK_URLS`、隐私政策，以及运行时品牌（`PWA_APP_NAME` / `PWA_APP_SHORT_NAME` / `PWA_APP_DESCRIPTION` / `APP_TITLE` / `JOIN_TITLE` / `APP_ICON` 等，见「PWA 与 iPhone 主屏幕」）。`PUBLIC_BASE_URL` 必须和用户实际访问的域名一致。
- `APP_API_BASE` 只用于 APK 外壳加载 `/app/index.html` 和开发代理；它不再进入页面包，也不参与运行时包构建。**APK 仍按实例构建**（同一个 APK 不能指向多个域名）；运行时包里的页面产物是共享的。
- 构建后可用下面的检查确认页面包没有写死实例域名；`web/check-page-bundle.mjs` 已经接成 Vite 构建插件，`pnpm --dir web build`、`build:join` 与 `--watch` 每次写完后都会检查，出现域名就让构建失败：

```bash
node web/check-page-bundle.mjs web/dist web/dist-join
```

- PWA 的 `manifest.start_url` / `scope` 是 `/app/`，图标和 Service Worker 也都是相对路径；同一份页面放到不同 `PUBLIC_BASE_URL` 下即可安装。安装后的主屏幕名称/图标是各实例安装时的快照，改运行时品牌后要重新添加。
- 如果某个实例把 API 放到另一个源，请在反代上把 `/api`、`/media` 同域转发到 API；不要把域名写进页面包，否则会重新引入“换域名要重建”的问题，并额外破坏 WebAuthn 的 RP ID/origin 校验。

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

通行密钥与更新检查还会读三个可选变量：`WEBAUTHN_RP_ID`（默认取 `PUBLIC_BASE_URL` 的主机名，**必须与用户实际打开页面的域名一致**，否则浏览器拒绝调用）、`WEBAUTHN_RP_NAME`、`WEBAUTHN_ORIGINS`（逗号分隔的完整来源，默认含 `PUBLIC_BASE_URL` 与本地 `http://localhost:<PORT>`；**App 内使用通行密钥时还必须加上 `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`**，否则系统凭据提供方发回的断言会因来源不符被拒）；下载源选 GitHub 仓库时可以配 `GITHUB_TOKEN` 提高 GitHub API 额度（不配也能用，只是每小时次数少）。语言包不随页面发布：它放在用户机器的本机存储里，由 `LANG_PACK_URLS` 指向的任意 https 地址下载（或用户在设置里选 JSON 文件安装）。应用与报名站都按 `LANG_PACK_DEFAULT` 选默认语言；对应包需要能从 `LANG_PACK_URLS` 下载或已装在客户端本机，否则回退中文。这些值直接写在服务器 `/etc/calmobile.env`，更新器只补缺失键，不改已有值；改已有值要直接改文件并重启。

### GitHub Variables 与 Secrets

GitHub Variables：`APP_API_BASE`（`https://域名/api/v1`，只给 APK 外壳和开发代理用，不进入页面包，服务器不需要配置）、`PUBLIC_BASE_URL`（`https://域名`）、`PRIVACY_POLICY_URL`、`LANG_PACK_DEFAULT`（默认语言包名称）、`LANG_PACK_URLS`（`名称=链接`，逗号或空白分开）。这些值会出现在 Actions 日志里，服务器地址、口令和私钥不要写进来。

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
11. 外壳有改动时，正式包用 `./gradlew :app:assembleRelease`，或由上面的 Release 工作流在 `master` 的合并提交通过 CI 后构建。`APP_API_BASE` 是与 `PUBLIC_BASE_URL` 同一个源的 `https://域名/api/v1`，只决定 APK 外壳加载哪个源；页面包用相对接口，不写域名。包名是 `com.blathroat.calmobile`。签名四项指向正式密钥。`ENABLE_WEB=true`，运行时包里的 `web/dist-join` 已由更新器放到当前版本目录。
12. 改了 PWA 清单、Service Worker、安装引导或 `web/public/icons/` 时，按上面的 iPhone 真机验收清单过一遍，并确认 `/app/manifest.webmanifest`、`/app/sw.js`、`/app/icons/` 在线且 MIME 与缓存正确。
