# 本机数据库（WSL 里的 PostgreSQL）启停与状态检查。
#
# 用法示例：
#   pwsh -File scripts\db.ps1 start     # 确保 WSL 发行版与 PostgreSQL 已启动
#   pwsh -File scripts\db.ps1 status    # 只看状态
#   pwsh -File scripts\db.ps1 stop      # 停止 PostgreSQL
#   pwsh -File scripts\db.ps1 psql      # 打开 psql 交互（用 postgres 账号）

param(
    [Parameter(Position = 0)][string]$Action = 'start',
    [string]$Distro = $env:CALMOBILE_WSL_DISTRO
)

$ErrorActionPreference = 'Stop'

if (-not $Distro) {
    # 默认取第一个非 docker 的发行版
    $Distro = (wsl -l -q) |
        ForEach-Object { ($_ -replace "`0", '').Trim() } |
        Where-Object { $_ -and $_ -notlike 'docker-desktop*' } |
        Select-Object -First 1
}
if (-not $Distro) { throw '没有找到可用的 WSL 发行版，请设置 CALMOBILE_WSL_DISTRO' }

function Invoke-Wsl {
    param([string]$Command)
    # 注意：-d/-u 之后不要再加引号参数，否则会被当成命令的一部分。
    & wsl -d $Distro -- sudo -n bash -lc $Command
}

switch ($Action) {
    'start' {
        # WSL 发行版是按需启动的：这条命令本身会把它拉起来，systemd 随后拉起 PostgreSQL。
        Invoke-Wsl 'service postgresql start >/dev/null 2>&1; sleep 1; pg_lsclusters'
    }
    'stop' {
        Invoke-Wsl 'service postgresql stop; pg_lsclusters'
    }
    'status' {
        Invoke-Wsl 'pg_lsclusters'
    }
    'psql' {
        Invoke-Wsl 'sudo -u postgres psql -d calmobile_dev'
    }
    default {
        throw "未知操作：$Action（可用：start / stop / status / psql）"
    }
}
