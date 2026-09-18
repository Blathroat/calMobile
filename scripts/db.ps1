# 本机数据库启停与状态检查。
#
# 默认用 Docker 跑 PostgreSQL（推荐）：不污染本机、版本固定、数据放在命名卷里。
# 也支持另一条路：WSL 发行版里用 apt 装的 PostgreSQL（没有 Docker 时的备选）。
#
# 用法：
#   pwsh -File scripts\db.ps1 start                 # 起数据库（默认 Docker）
#   pwsh -File scripts\db.ps1 status                # 查看状态
#   pwsh -File scripts\db.ps1 stop                  # 停数据库
#   pwsh -File scripts\db.ps1 psql                  # 打开 psql
#   pwsh -File scripts\db.ps1 start -Provider wsl   # 用 WSL 里的 PostgreSQL
#
# 两条路都监听 127.0.0.1:5432，因此 server/.env 不用改；同一时间只应该跑一个。

param(
    [Parameter(Position = 0)][string]$Action = 'start',
    [ValidateSet('docker', 'wsl')][string]$Provider = 'docker',
    [string]$Distro = $env:CALMOBILE_WSL_DISTRO
)

$ErrorActionPreference = 'Stop'

# 与 server/.env、server/README.md 保持一致
$ContainerName = 'calmobile-pg'
$VolumeName = 'calmobile-pgdata'
$Image = 'postgres:16-alpine'
$DbName = 'calmobile_dev'
$DbUser = 'postgres'
$DbPassword = 'postgres'
# 容器默认是 UTC：不设时区的话，本机 00:00–08:00 这段时间里数据库的 CURRENT_DATE
# 还停在昨天，报名窗口与日历落点会跟着差一天。
$TimeZone = 'Asia/Shanghai'

function Assert-Docker {
    docker version --format '{{.Server.Version}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker 引擎没在跑：先启动 Docker Desktop，或改用 -Provider wsl'
    }
}

function Get-DockerState {
    $state = docker inspect -f '{{.State.Status}}' $ContainerName 2>$null
    if ($LASTEXITCODE -ne 0) { return 'missing' }
    return $state
}

function Show-DockerStatus {
    Assert-Docker
    docker ps -a --filter "name=$ContainerName" --format '{{.Names}} | {{.Status}} | {{.Ports}}'
    if ((Get-DockerState) -eq 'running') {
        docker exec $ContainerName psql -U $DbUser -d $DbName -tAc 'SHOW timezone' |
            ForEach-Object { "timezone = $($_.Trim())" }
        docker exec $ContainerName psql -U $DbUser -d $DbName -tAc 'SELECT CURRENT_DATE' |
            ForEach-Object { "CURRENT_DATE = $($_.Trim())" }
        docker exec $ContainerName psql -U $DbUser -tAc `
            'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname' |
            ForEach-Object { "database: $($_.Trim())" }
    }
}

function Start-DockerDb {
    Assert-Docker
    $state = Get-DockerState
    if ($state -eq 'running') {
        Write-Output "容器 $ContainerName 已在运行"
    } elseif ($state -eq 'missing') {
        Write-Output "创建容器 $ContainerName（数据卷 $VolumeName）"
        docker run -d --name $ContainerName `
            -e "POSTGRES_PASSWORD=$DbPassword" -e "POSTGRES_USER=$DbUser" -e "POSTGRES_DB=$DbName" `
            -e "TZ=$TimeZone" -e "PGTZ=$TimeZone" `
            -p 5432:5432 -v "${VolumeName}:/var/lib/postgresql/data" `
            --restart unless-stopped $Image `
            -c "timezone=$TimeZone" | Out-Null
    } else {
        Write-Output "启动已存在的容器 $ContainerName（当前状态 $state）"
        docker start $ContainerName | Out-Null
    }
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        docker exec $ContainerName pg_isready -U $DbUser -d $DbName *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Output "数据库就绪（约 $(([int]$i * 2) + 2)s）"
            Show-DockerStatus
            return
        }
    }
    throw "容器起来了但数据库没就绪，用 docker logs $ContainerName 看原因"
}

# ── WSL 备选 ─────────────────────────────────────────────────────

function Resolve-Distro {
    if ($Distro) { return $Distro }
    $found = (wsl -l -q) |
        ForEach-Object { ($_ -replace "`0", '').Trim() } |
        Where-Object { $_ -and $_ -notlike 'docker-desktop*' } |
        Select-Object -First 1
    if (-not $found) { throw '没有找到可用的 WSL 发行版，请设置 CALMOBILE_WSL_DISTRO' }
    return $found
}

function Invoke-Wsl {
    param([string]$Command)
    & wsl -d (Resolve-Distro) -- sudo -n bash -lc $Command
}

switch ($Action) {
    'start' {
        if ($Provider -eq 'wsl') { Invoke-Wsl 'service postgresql start >/dev/null 2>&1; sleep 1; pg_lsclusters' }
        else { Start-DockerDb }
    }
    'stop' {
        if ($Provider -eq 'wsl') { Invoke-Wsl 'service postgresql stop; pg_lsclusters' }
        else { docker stop $ContainerName }
    }
    'status' {
        if ($Provider -eq 'wsl') { Invoke-Wsl 'pg_lsclusters' }
        else { Show-DockerStatus }
    }
    'psql' {
        if ($Provider -eq 'wsl') { Invoke-Wsl "sudo -u postgres psql -d $DbName" }
        else { docker exec -it $ContainerName psql -U $DbUser -d $DbName }
    }
    default {
        throw "未知操作：$Action（可用：start / stop / status / psql）"
    }
}
