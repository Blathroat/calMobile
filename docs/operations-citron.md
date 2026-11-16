# Citron 实例运维

本文件只写 `citron.sarl` 这一套实例的当前运维行为。公共的上线规则、路径触发范围和发布流程见 [`operations.md`](operations.md)；`blathroat.lol` 主实例仍是那套默认布局。

## 站点与网络

| 项 | 值 |
|---|---|
| 域名 | `citron.sarl`（Cloudflare zone） |
| 入口 | Cloudflare Tunnel `calmobile-citron`（CNAME `citron.sarl` → `<tunnel-id>.cfargotunnel.com`，橙色云） |
| 源站 | 不监听公网 80/443；应用只监听 `127.0.0.1:3001`（容器/主机上为 `*:3001`，UFW 不放行） |
| Tunnel 服务 | `cloudflared-citron.service`（`/etc/cloudflared-citron.env`，root 600，unit 在 `/etc/systemd/system/`） |
| TLS | Cloudflare 边缘证书；源站无证书，外部直接扫源站看不到 `citron.sarl` 的 SNI |
| 页面 | `/` 为报名站；`/app/*` 固定 404（不提供应用页面快照）；`/ping` 在 Tunnel ingress 里返回 404 |

Tunnel 的 ingress 配置在 Cloudflare 侧（通过 API 设置），包含 `^/ping/?$ → http_status:404`，其余 `citron.sarl → http://127.0.0.1:3001`。

## 服务器布局

| 用途 | 路径 / 单元 |
|---|---|
| 部署根 | `/opt/calmobile-citron`（`releases/<版本>/{server,web}` + `current` + `state`） |
| 环境文件 | `/etc/calmobile-citron.env`（root 600） |
| 应用单元 | `calmobile-citron.service`（User=blathroat，`WorkingDirectory=/opt/calmobile-citron/current/server`） |
| 更新器 | `/usr/local/lib/calmobile-citron/calmobile-update.mjs` |
| 更新器配置 | `/etc/calmobile-citron-update.json` |
| 更新单元/定时器 | `calmobile-citron-update.service` / `.timer`（与主实例错峰） |
| 上传目录 | `/var/lib/calmobile-citron/uploads` |
| 数据库 | PostgreSQL 本机 5432，库 `calmobile_citron`，角色 `calmobile_citron` |
| 管理员 | `citrus`（首次启动由 `ADMIN_*` 创建，密码在环境文件） |
| APK 源文件 | R2 桶 `calmobile-citron-downloads`（公开只读域名 `dl.citron.sarl`） |
| 备份 | R2 桶 `calmobile-citron-backup`（私有） |
| 备份脚本/配置 | `/usr/local/lib/calmobile-citron/backup.sh`、`/etc/calmobile-citron-backup.env`（root 600） |
| 备份单元/定时器 | `calmobile-citron-backup.service` / `.timer`（每天 03:30 CST，保留 30 天） |
| 签名材料 | `/etc/calmobile-citron-android/{citron-release.jks,credentials.env}`（root 700/600） |

`calmobile-citron.service` 启动前会删除 `current/web/dist`（不对外提供 `/app`），再把 `brand/dist-join-extra/.` 覆盖到 `current/web/dist-join/`（`assetlinks.json` 在这里；APK 不再从服务器提供）。

## 更新运行时

与主实例共用 npm 包 `calmobile-server@0.1.<运行编号>`，但目录、服务、环境文件和定时器完全独立：

```
node /usr/local/lib/calmobile-citron/calmobile-update.mjs --check
CALMOBILE_CONFIG_PATH=/etc/calmobile-citron-update.json \
  node /usr/local/lib/calmobile-citron/calmobile-update.mjs --update
sudo systemctl start calmobile-citron-update.service
journalctl -u calmobile-citron-update.service -n 100
```

- 更新器只补 `/etc/calmobile-citron.env` 缺失的键，不覆盖已有值。
- 失败自动回滚并写 `/opt/calmobile-citron/state/pin`；修好后 `--unpin`。
- `keep=2`，只保留最近两个版本。
- 更新后 `calmobile-citron.service` 重启；`brand/dist-join-extra` 的 assetlinks 会重新叠加。

## 数据库与上传备份

- 每天 03:30（CST）`calmobile-citron-backup.timer` 触发：
  - `pg_dump -Fc calmobile_citron` → `citron/<日期>/db.dump`
  - `tar czf uploads.tgz /var/lib/calmobile-citron/uploads` → `citron/<日期>/uploads.tgz`
  - `manifest.txt` 记录两个文件的 sha256
  - 上传到 R2 桶 `calmobile-citron-backup`，删除 30 天前的对象。
- 手动跑一次：`sudo systemctl start calmobile-citron-backup.service`；日志在 `journalctl -u calmobile-citron-backup.service`。
- R2 凭据在 `/etc/calmobile-citron-backup.env`（`R2_ENDPOINT`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`KEEP_DAYS`）。
- 恢复思路：从 R2 下载对应日期的 `db.dump` 与 `uploads.tgz`，`pg_restore` 到新库，再替换 `UPLOAD_DIR` 内容；恢复前先停 `calmobile-citron.service`。

## APK 与下载

- 包名 `com.citron.expo`，显示名 `Citron Expo`，版本 `0.1.0`（versionCode `1`）。
- 签名：自签 RSA 2048，alias `citron`；证书 SHA-256 指纹和 `android:apk-key-hash` 见 `assetlinks.json` 与服务端 `WEBAUTHN_ORIGINS`。
- 公开下载地址：`https://dl.citron.sarl/citron.apk`（R2 自定义域，不经过应用服务器）。
- 旧地址 `https://citron.sarl/citron.apk` 由 Cloudflare Redirect Rule 301 到 R2 地址；不要再把 APK 放回服务器。
- `citron.sarl/.well-known/assetlinks.json` 声明包名与签名指纹；服务端 `WEBAUTHN_ORIGINS` 含对应 `android:apk-key-hash:`。
- 应用内下载源（`app_settings.download`）指向 `https://dl.citron.sarl/citron.apk`。

### 以后发新版 APK

1. 用同一份 keystore 构建，递增 `ANDROID_VERSION_CODE`（2、3…）和 `ANDROID_VERSION_NAME`：
   ```bash
   ANDROID_APPLICATION_ID=com.citron.expo \
   ANDROID_VERSION_CODE=2 ANDROID_VERSION_NAME=0.1.1 \
   APP_API_BASE=https://citron.sarl/api/v1 \
   ANDROID_KEYSTORE_PATH=.../citron-release.jks \
   ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_ALIAS=citron ANDROID_KEY_PASSWORD=... \
   ./gradlew :app:assembleRelease
   ```
2. 用 R2 S3 凭据覆盖 `calmobile-citron-downloads` 里的 `citron.apk`（同时保留带版本号的副本，如 `citron/citron-0.1.1.apk`）。
3. 不需要改服务器；`https://dl.citron.sarl/citron.apk` 保持稳定。
4. 包名不要改；keystore 丢失后无法给已安装用户升级。

### 构建方式

当前是**本机手动构建 + 上传 R2**。不在服务器上安装 Android SDK / JDK 构建（已撤回该想法）。以后可选的自动化：

- 私有 GitHub 仓库 + Actions 构建，产物推到 R2（推荐；private 仓库的 Release 不能匿名下载，所以下载仍走 R2）。
- Cloudflare Workers 只适合做触发/分发（Cron 或 HTTP 触发 GitHub Actions、从 R2 读最新 APK），**不适合直接跑 Android/Gradle 构建**：Workers 运行时没有 JVM/进程/大磁盘；Cloudflare Containers 即使能跑镜像，Android SDK + Gradle 缓存通常超出镜像与启动限制，构建慢且成本高。

## 凭据与备份位置

| 内容 | 服务器位置 | 本地副本 |
|---|---|---|
| Citron 环境变量（DB/JWT/TOTP/SMTP/ADMIN/WebAuthn） | `/etc/calmobile-citron.env` | 桌面 `calmobile-ops-*` |
| R2 备份凭据 | `/etc/calmobile-citron-backup.env` | 同上 |
| APK 签名 keystore 与口令 | `/etc/calmobile-citron-android/` | 同上 + `.agents/citron-android` |
| APK 指纹、assetlinks、APK 文件 | 服务器 / R2 | 同上 |
| R2 下载桶 | `calmobile-citron-downloads`（公开域 `dl.citron.sarl`） | — |
| R2 备份桶 | `calmobile-citron-backup`（私有） | — |

- 这些文件里有密钥，桌面副本请离线保管，不要进 Git、不要发给第三方。
- keystore 和 `credentials.env` 丢失后无法更新已安装应用；`/etc/calmobile-citron.env` 丢失后需从备份/桌面副本恢复。
- R2 访问用 `cfut_` 用户 token 派生的 S3 凭据（Access Key ID = token id，Secret = token 值的 SHA-256）；换 token 后要同步更新 `/etc/calmobile-citron-backup.env` 和下载上传脚本使用的凭据。

## 排查

| 现象 | 检查 |
|---|---|
| `citron.sarl` 502/1033 | `systemctl status cloudflared-citron`、`systemctl status calmobile-citron`、Tunnel 是否在线 |
| `/ping` 404 | 正常：Tunnel ingress 主动屏蔽；本机 `curl 127.0.0.1:3001/ping` 应为 200 |
| `/app/*` 404 | 正常：该实例不提供应用页面 |
| 更新失败 | `journalctl -u calmobile-citron-update.service`；`readlink -f /opt/calmobile-citron/current` |
| 备份失败 | `journalctl -u calmobile-citron-backup.service`；`/etc/calmobile-citron-backup.env` 凭据是否过期 |
| 下载 404 | 检查 R2 桶对象 `citron.apk`、`dl.citron.sarl` 自定义域状态、Cloudflare Redirect Rule |

## 反关联残余

- 同一台服务器、同一个 Cloudflare 账户，两个域名的 NS 对相同（`dom.ns.cloudflare.com` / `walk.ns.cloudflare.com`），公开 DNS 可关联。
- 两个实例用同一个 npm 包，报名站静态资源文件名/哈希相同，代码指纹一致。
- 源站 IP 对 `blathroat.lol` 仍可直连；`citron.sarl` 走 Tunnel 不暴露源站，但共享底层硬件/账户。
- 要做到更强隔离，需要独立 Cloudflare 账户（不同 NS）、独立构建产物/包名、独立 APK 签名，最好独立 IP/服务器。
