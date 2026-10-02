# 构建、测试与上线

本文件只保留跨模块的操作流程。后端命令、环境变量、迁移和状态页细节见 [`server/README.md`](../server/README.md)。

开发与运行要求 Node.js 24.15+（24.x）或 26+，使用两个工程 `packageManager` 固定的 pnpm 版本。前后端安装均启用冻结锁文件。

前端 `vue-tsc` 使用官方 `@typescript/typescript6` 兼容包（以 `typescript` 别名安装）；TypeScript 7 的原生编译入口暂不受当前 Vue 类型检查器支持。后端使用 TypeScript 7。升级时保留 `.vue` 类型检查门禁。

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

## 对外部署（域名、TLS 与上传）

服务本身只监听 http，**TLS 由前面的反向代理终止**（证书、续期、HTTP/2 都在那一层）。下面几项都是可选的：不配就是本机开发形态。

| 环境变量 | 作用 | 不配时 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 对外访问地址（`https://app.example.com`），状态页与 `/ping` 显示它；也是以后邮件里绝对链接的基址 | 状态页只显示端口，不显示域名 |
| `FORCE_HTTPS` | 反代终止 TLS 时打开：`X-Forwarded-Proto: http` 的请求 308 跳到 https | 不跳转，明文请求照常处理 |
| `HSTS_MAX_AGE` | `Strict-Transport-Security` 的 max-age（秒），默认 180 天 | 下发默认值；填 `0` 表示不下发 |
| `TRUST_PROXY` | 反代后面必须打开，否则 `req.ip` 是代理地址，按 IP 的验证码限流退化成全局额度 | 关闭（直连） |
| `CORS_ORIGIN` | 允许的前端来源。App 页面跑在 WebView 的 `https://appassets.androidplatform.net`，浏览器调试用 `*` | `*`（仅开发） |
| `ENABLE_STATUS_PAGE` | `/status` 与 `/api/v1/status`：迁移清单、各表行数与接口清单 | 生产关闭、其它环境开启 |

部署检查单：

1. `pnpm start` 的自检会把「会出事」的配置直接拒绝启动（开发密钥、默认库口令、占位发件人……），先让它过。
2. 反代把域名指向服务端口，只暴露 443；配 `proxy_set_header X-Forwarded-Proto $scheme;` 与 `X-Forwarded-For`，服务端设 `TRUST_PROXY=1`。
3. 确认 https 全站可用之后再开 `FORCE_HTTPS` 与长 `HSTS_MAX_AGE`（HSTS 一旦下发，浏览器会长期拒绝 http 访问）。
4. `CORS_ORIGIN` 换成真实来源，不要留 `*`。
5. 状态页要么关掉，要么在反代上加 Basic Auth 并只允许内网访问。

nginx 最小片段：

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    client_max_body_size 12m;              # 与 app_settings.upload / media 的上限对齐

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

**上传与媒体**：当前媒体（展会封面、头像、简介里的图片与视频）由**设备侧**处理 —— 原生选图、压缩后落在设备私有目录，后端只存一个短 URL，因此换设备看不到旧图。要改成服务端上传，需要在这个仓库里另开一轮工作（上传接口 + 落盘目录 + 静态分发 + 前端改走接口），届时新增的配置建议沿用这几个名字：`UPLOAD_DIR`（落盘目录）、`MEDIA_BASE_URL`（对外访问前缀）、`UPLOAD_MAX_MB`（单文件上限，与 `app_settings.upload` 的校验对齐）。单次请求体上限由 `client_max_body_size` 与服务的 JSON 体积守卫（2MB）分别把关，上传接口要单独放宽前者。

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

- Vue 前端：`node scripts/webui-check.js`（类型检查、单测与生产构建三件套）；生成 APK 时 `preBuild` 自动将 `web/dist` 同步到 generated WebView 资源。

- 前端路由、加载和文案：渲染测试、字符串检查。
- 后端规则或响应：服务端单测与契约测试；数据库相关测试需要 PostgreSQL。
- Java 或桥接：`testDebugUnitTest`；出包或资源变更再运行 `assembleDebug`。
- 前端文案源码变更后先运行 `node scripts/extract-strings.js --write`。

## 模拟器与真机回归

```powershell
pwsh -File scripts\emu.ps1 install
pwsh -File scripts\emu.ps1 reverse
pwsh -File scripts\emu.ps1 shot .omo\evidence\screen
pwsh -File scripts\emu.ps1 logs
pwsh -File scripts\emu.ps1 motion check
```

页面里的接口地址写死 `http://127.0.0.1:3000`（WebView 不允许别的写法），模拟器里的 `127.0.0.1` 又是模拟器自己，因此必须把设备的 3000 端口反向映射到本机。**`pnpm dev` 会自动接好并在运行期间看护**（`src/dev/adb-reverse.ts`：每 5 秒查一次，没设备时降到 15 秒，设备晚启动、adb server 重启后都会补回），所以只跑 `pnpm dev` 就能直接调试；日志里出现「已接通设备 tcp:3000 → 本机 tcp:3000（adb reverse）」就说明通了。`ADB_REVERSE=0` 可关掉自动接通。

`emu.ps1 install` 与 `restart` 也会确保一次，服务不是用 `pnpm dev` 起的（例如 `pnpm start`）就单独跑 `reverse`。症状是应用里每个请求都失败、页面提示「连不上后端服务」，看起来像「后端没起」——先看这句提示，再看映射在不在（`adb reverse --list`）。

WebView 文字不一定出现在无障碍树中，点击回归用坐标并保留截图证据；扫码回归可用 `node scripts/decode-shot.js` 检查真实截图像素。

## 浏览器逐屏回归（CDP）

模拟器里点坐标很脆（软键盘会改变布局、WebView 文案不一定进无障碍树），界面回归优先用 CDP 跑真实 Chromium：

```bash
pnpm --dir web build
pnpm --dir web exec vite preview --port 5173 --strictPort   # 另开一个终端
node scripts/ui-shot.mjs --out .omo/evidence/ui --account user --routes settings,profile
node scripts/ui-shot.mjs --stub-native --routes settings      # 桩掉原生桥，跑通选图/裁剪等设备流程
node scripts/ui-shot.mjs --account demo --routes admin --click 展会
```

脚本自己拉起 headless Chrome 并在结束时关掉它；需要后端在 `127.0.0.1:3000`，开发期把 `CORS_ORIGIN` 设为 `*`。

改动页面文案后，用它对照重构前的实现看有没有整块丢失：

```bash
node scripts/ui-parity.mjs          # 与 Vue 迁移前固定提交 6491a068 对照 t('s_xxx') 覆盖
node scripts/ui-parity.mjs --full   # 连「搬到了别处」的 key 一起打印
node scripts/ui-parity.mjs --ref <commit> --max-gone 70  # 显式选择含全部旧页面的参考提交
```

`→ 无` 才是真缺口；`→ web/src/...` 说明那条文案搬到了路由 meta、共享服务或共享组件里。

CI 里这两个脚本都在跑：`ui-parity` 在 `web-and-server` 作业（固定基准 `6491a068f05d8a17ba51e9d3eb073eda4363755f`、`--max-gone 70`，超预算说明有整块界面没搬过来；需要完整 Git 历史，参考提交无效或任一参考页面缺失都失败），
`ui-shot` 在 `ui-regression` 作业（自带 PostgreSQL 服务、迁移 + 示例数据、后端与 `vite preview`，截图作为 `ui-screenshots` 工件上传）。
预算值随有意删除的文案调整。`ui-shot` 的 `detail` 别名会从后端公开展会列表选择真实 id，也可指定 `detail/<id>`；没有展会时失败。截图前检查目标路由、顶栏标题、正文和加载状态，登录失败、权限重定向、空白正文或页面错误都报错，并保存 `failure.png`。`--click` 指定的操作不存在时同样失败。

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
- 使用 Node.js 24.15+（24.x）或 26+，在 `server/` 执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，再执行 `pnpm db:migrate:prod` 并重启生产进程；迁移完成后才切流量。
- 数据库启用 `Asia/Shanghai` 时区，配置备份、恢复演练和日志轮转。
- 上传媒体仍在客户端私有目录；上线前确认这符合产品范围，或先完成对象存储和上传接口。
- 注册和安全邮件涉及个人信息，注册页需要隐私告知；营销或提醒邮件需要退订机制。

## 上线限制

当前服务没有默认的公网部署形态、域名和 HTTPS。已有域名与服务器时，证书可用 Let's Encrypt；成本、邮件服务和备案取决于部署地区，具体供应商额度不写入代码文档。

发布完成后检查生产日志中的运行模式、配置自检和邮件失败计数；故障详情留在服务端日志，不向客户端返回数据库地址、SQL 或堆栈。
