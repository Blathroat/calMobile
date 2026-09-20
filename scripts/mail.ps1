# 本机开发收件箱（Mailpit 容器）。
#
# 后端发验证码邮件时需要一个 SMTP 服务器。本地**不自建发信服务**、也不往真实邮箱发：
# Mailpit 全盘接收并留在容器里，验证码在网页上直接看。
#
# 用法：
#   pwsh -File scripts\mail.ps1 start    # 确保容器在跑（不存在就创建），并等到端口可用
#   pwsh -File scripts\mail.ps1 status   # 容器状态 + 收件箱里的邮件数与最近几封
#   pwsh -File scripts\mail.ps1 open     # 用浏览器打开收件箱
#   pwsh -File scripts\mail.ps1 clear    # 清空收件箱（跑回归前先清，免得看错邮件）
#   pwsh -File scripts\mail.ps1 logs     # 看容器日志
#   pwsh -File scripts\mail.ps1 stop     # 停止容器
#   pwsh -File scripts\mail.ps1 reset    # 删掉容器（邮件都在容器里，删了就没了）
#
# 与 server/.env 的对应关系：
#   MAIL_TRANSPORT=smtp
#   MAIL_SMTP_HOST=127.0.0.1
#   MAIL_SMTP_PORT=1025        # 上面的 $SmtpPort
#   MAIL_SMTP_SECURE=false     # Mailpit 默认明文 + STARTTLS 可选
# 不想开容器时把 MAIL_TRANSPORT 改成 console：验证码会直接打进后端日志。

param(
    [Parameter(Position = 0)][string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'

$ContainerName = 'calmobile-mail'
$Image = 'axllent/mailpit:latest'
$SmtpPort = 1025
$UiPort = 8025
$BaseUrl = "http://127.0.0.1:$UiPort"

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

# Mailpit 的收件箱 API（GET /api/v1/messages）；容器没起或版本不支持时返回 $null。
function Get-Messages {
    try {
        return Invoke-RestMethod -Uri "$BaseUrl/api/v1/messages" -TimeoutSec 3
    } catch {
        return $null
    }
}

function Show-Status {
    Assert-Docker
    docker ps -a --filter "name=$ContainerName" --format '{{.Names}} | {{.Status}} | {{.Ports}}'
    if ((Get-State) -ne 'running') {
        return
    }
    Write-Output "SMTP:   127.0.0.1:$SmtpPort"
    Write-Output "收件箱: $BaseUrl"
    $inbox = Get-Messages
    if ($null -eq $inbox) {
        Write-Output '收件箱 API 暂时读不到（容器刚起或版本不支持 /api/v1/messages）'
        return
    }
    Write-Output "邮件数: $($inbox.total)"
    foreach ($message in @($inbox.messages | Select-Object -First 5)) {
        $subject = $message.Subject
        $to = ($message.To | ForEach-Object { $_.Address }) -join ', '
        Write-Output "  · $($message.Created) → $to | $subject"
    }
}

function Start-Mail {
    Assert-Docker
    $state = Get-State
    if ($state -eq 'running') {
        Write-Output "容器 $ContainerName 已在运行"
    } elseif ($state -eq 'missing') {
        Write-Output "创建容器 $ContainerName（镜像 $Image）"
        docker run -d --name $ContainerName `
            -p "${SmtpPort}:1025" -p "${UiPort}:8025" `
            --restart unless-stopped $Image | Out-Null
    } else {
        Write-Output "启动已存在的容器 $ContainerName（当前状态 $state）"
        docker start $ContainerName | Out-Null
    }
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if ((Get-State) -eq 'running' -and $null -ne (Get-Messages)) {
            Write-Output '收件箱就绪'
            Show-Status
            return
        }
    }
    throw "容器起来了但收件箱 API 没响应，用 docker logs $ContainerName 看原因"
}

switch ($Action) {
    'start' { Start-Mail }
    'status' { Show-Status }
    'open' { Assert-Docker; Start-Process $BaseUrl }
    'clear' {
        Assert-Docker
        Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/v1/messages" -TimeoutSec 5 | Out-Null
        Write-Output '收件箱已清空'
    }
    'logs' { Assert-Docker; docker logs --tail 50 $ContainerName }
    'stop' { Assert-Docker; docker stop $ContainerName }
    'reset' {
        Assert-Docker
        Write-Output "删除容器 $ContainerName（容器里的邮件会一起没）"
        docker rm -f $ContainerName *> $null
    }
    default {
        throw "未知操作：$Action（可用：start / status / open / clear / logs / stop / reset）"
    }
}
