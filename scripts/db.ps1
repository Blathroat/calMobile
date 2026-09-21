# 本机数据库（Docker 里的 PostgreSQL）启停与状态检查。
#
# 用法：
#   pwsh -File scripts\db.ps1 start     # 确保容器在跑（不存在就创建），并等到就绪
#   pwsh -File scripts\db.ps1 status    # 查看容器状态、时区、当前日期与库列表
#   pwsh -File scripts\db.ps1 stop      # 停止容器（数据留在命名卷里）
#   pwsh -File scripts\db.ps1 psql      # 打开 psql 交互
#   pwsh -File scripts\db.ps1 reset     # 删掉容器与数据卷（会清空数据，需再次 migrate + seed）

param(
    [Parameter(Position = 0)][string]$Action = 'start'
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
        throw 'Docker 引擎没在跑：先启动 Docker Desktop'
    }
}

function Get-State {
    $state = docker inspect -f '{{.State.Status}}' $ContainerName 2>$null
    if ($LASTEXITCODE -ne 0) { return 'missing' }
    return $state
}

function Show-Status {
    Assert-Docker
    docker ps -a --filter "name=$ContainerName" --format '{{.Names}} | {{.Status}} | {{.Ports}}'
    if ((Get-State) -ne 'running') {
        return
    }
    docker exec $ContainerName psql -U $DbUser -d $DbName -tAc 'SHOW timezone' |
        ForEach-Object { "timezone = $($_.Trim())" }
    docker exec $ContainerName psql -U $DbUser -d $DbName -tAc 'SELECT CURRENT_DATE' |
        ForEach-Object { "CURRENT_DATE = $($_.Trim())" }
    docker exec $ContainerName psql -U $DbUser -tAc `
        'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname' |
        ForEach-Object { "database: $($_.Trim())" }
}

function Start-Db {
    Assert-Docker
    $state = Get-State
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
            Show-Status
            return
        }
    }
    throw "容器起来了但数据库没就绪，用 docker logs $ContainerName 看原因"
}

switch ($Action) {
    'start' { Start-Db }
    'stop' { Assert-Docker; docker stop $ContainerName }
    'status' { Show-Status }
    'psql' { Assert-Docker; docker exec -it $ContainerName psql -U $DbUser -d $DbName }
    'reset' {
        Assert-Docker
        Write-Output "删除容器 $ContainerName 与数据卷 $VolumeName（数据会丢）"
        docker rm -f $ContainerName *> $null
        docker volume rm $VolumeName *> $null
        Start-Db
        Write-Output '接下来在 server/ 里跑：pnpm run db:migrate; pnpm run db:seed'
    }
    default {
        throw "未知操作：$Action（可用：start / stop / status / psql / reset）"
    }
}
