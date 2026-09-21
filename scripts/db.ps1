# 本机数据库启停与状态检查。
#
# 镜像、挂载点、时区、卷名都定义在仓库根的 docker-compose.yml，本脚本只是薄封装：
#   pwsh -File scripts\db.ps1 start     # docker compose up -d db，并等到就绪
#   pwsh -File scripts\db.ps1 status    # 容器状态、时区、当前日期与库列表
#   pwsh -File scripts\db.ps1 stop      # docker compose stop db（数据留在命名卷里）
#   pwsh -File scripts\db.ps1 psql      # 直接进 psql
#   pwsh -File scripts\db.ps1 reset     # 删掉容器与数据卷（会清空数据，需再次 migrate + seed）
#
# 不用脚本时直接用 compose（在仓库根目录）：up -d / ps / logs / exec db psql / stop / down -v。

param(
    [Parameter(Position = 0)][string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'

# 与 docker-compose.yml、server/.env 保持一致
$Service = 'db'
$ContainerName = 'calmobile-pg'
$VolumeName = 'calmobile-pgdata'
$DbName = 'calmobile_dev'
$DbUser = 'postgres'

# compose 文件在仓库根：不管从哪个目录调用都回根目录执行，避免用到别的 compose 文件
Set-Location (Split-Path -Parent $PSScriptRoot)

function Assert-Docker {
    docker version --format '{{.Server.Version}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker 引擎没在跑：先启动 Docker Desktop'
    }
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw '没有 docker compose 插件：Docker Desktop 自带，或升级 Docker'
    }
}

function Get-State {
    $state = docker inspect -f '{{.State.Status}}' $ContainerName 2>$null
    if ($LASTEXITCODE -ne 0) { return 'missing' }
    return $state
}

# 旧版脚本用 docker run 直接建的容器没有 compose 标签，compose up -d 不会接管它，
# 只会撞容器名冲突；那种卷还是 16 的旧布局，18 也用不了，让用户删掉重建。
function Test-LegacyContainer {
    $project = docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' $ContainerName 2>$null
    return ($LASTEXITCODE -eq 0) -and [string]::IsNullOrWhiteSpace($project)
}

function Show-Status {
    Assert-Docker
    docker compose ps $Service
    if ((Get-State) -ne 'running') {
        return
    }
    docker compose exec -T $Service psql -U $DbUser -d $DbName -tAc 'SHOW timezone' |
        ForEach-Object { "timezone = $($_.Trim())" }
    docker compose exec -T $Service psql -U $DbUser -d $DbName -tAc 'SELECT CURRENT_DATE' |
        ForEach-Object { "CURRENT_DATE = $($_.Trim())" }
    docker compose exec -T $Service psql -U $DbUser -d $DbName -tAc `
        'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname' |
        ForEach-Object { "database: $($_.Trim())" }
}

function Start-Db {
    Assert-Docker
    if (Test-LegacyContainer) {
        throw @"
容器 $ContainerName 是旧版脚本用 docker run 直接建的，compose 不会接管它（up -d 会撞容器名冲突），
而且它的数据卷还是 PostgreSQL 16 的旧布局，18 也用不了。删掉重建：
  pwsh -File scripts\db.ps1 reset
"@
    }
    # compose 自己判断要不要重建：改了镜像版本或挂载点，up -d 会自动换新容器。
    docker compose up -d $Service
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        docker compose exec -T $Service pg_isready -U $DbUser -d $DbName *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Output "数据库就绪（约 $(([int]$i * 2) + 2)s）"
            Show-Status
            return
        }
    }
    throw "容器起来了但数据库没就绪，用 docker compose logs $Service 看原因"
}

switch ($Action) {
    'start' { Start-Db }
    'stop' { Assert-Docker; docker compose stop $Service }
    'status' { Show-Status }
    'psql' { Assert-Docker; docker compose exec $Service psql -U $DbUser -d $DbName }
    'reset' {
        Assert-Docker
        Write-Output "删除容器 $ContainerName 与数据卷 $VolumeName（数据会丢）"
        # 不用 compose down：reset 只该动数据库，别把收件箱一起停掉。
        docker rm -f $ContainerName *> $null
        docker volume rm $VolumeName *> $null
        Start-Db
        Write-Output '接下来在 server/ 里跑：pnpm db:migrate; pnpm db:seed'
    }
    default {
        throw "未知操作：$Action（可用：start / stop / status / psql / reset）"
    }
}
