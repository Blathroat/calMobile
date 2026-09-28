# 模拟器回归辅助脚本：安装 APK、接通后端、截图、按可见文字点击。
# 用法示例：
#   pwsh -File scripts\emu.ps1 install
#   pwsh -File scripts\emu.ps1 reverse
#   pwsh -File scripts\emu.ps1 shot       .omo\evidence\02-home
#   pwsh -File scripts\emu.ps1 tap-text   "以访客身份浏览"

param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Action,
    [Parameter(Position = 1)][string]$Argument
)

$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$apk = Join-Path $PSScriptRoot '..\app\build\outputs\apk\debug\app-debug.apk'
$package = 'com.example.calmobile'
$apiPort = 3000

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & $adb @Args
}

<#
.SYNOPSIS
    让模拟器里的 WebView 能访问本机后端。

.DESCRIPTION
    页面里的接口地址写死 `http://127.0.0.1:$apiPort`（WebView 的混合内容限制不允许别的写法），
    而模拟器里的 127.0.0.1 是模拟器自己 —— 因此必须把设备的 3000 端口反向映射到本机。
    这个映射**不是永久的**：adb server 重启（`adb kill-server`、设备重连、机器重启）就会丢，
    症状是应用里每个请求都失败、看起来像「后端没起」，所以安装与重启动作都会先确保一次。
#>
function Initialize-Reverse {
    $device = (& $adb devices) | Select-String -Pattern '\sdevice$'
    if (-not $device) { throw '没有已连接的设备：先启动模拟器（或插上真机并允许调试）。' }
    & $adb reverse "tcp:$apiPort" "tcp:$apiPort" | Out-Null
    $listed = (& $adb reverse --list) -join ' '
    if ($listed -notmatch "tcp:$apiPort") {
        throw "反向端口映射没生效（adb reverse --list 里看不到 tcp:$apiPort）：$listed"
    }
    Write-Output "设备 tcp:$apiPort → 本机 tcp:$apiPort 已就绪（$($listed.Trim())）"
}

function Get-UiXml {
    & $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    $local = Join-Path $env:TEMP 'calmobile-ui.xml'
    & $adb pull /sdcard/ui.xml $local | Out-Null
    return Get-Content -Raw $local
}

function Get-Nodes {
    $xml = Get-UiXml
    $nodes = @()
    foreach ($tag in [regex]::Matches($xml, '<node\b[^>]*>')) {
        $text = [regex]::Match($tag.Value, 'text="([^"]*)"').Groups[1].Value
        if (-not $text) {
            $text = [regex]::Match($tag.Value, 'content-desc="([^"]*)"').Groups[1].Value
        }
        if (-not $text) { continue }
        $bounds = [regex]::Match($tag.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
        if (-not $bounds.Success) { continue }
        $nodes += [pscustomobject]@{
            Text     = $text
            X        = [int](([int]$bounds.Groups[1].Value + [int]$bounds.Groups[3].Value) / 2)
            Y        = [int](([int]$bounds.Groups[2].Value + [int]$bounds.Groups[4].Value) / 2)
            Clickable = $tag.Value -match 'clickable="true"'
        }
    }
    return $nodes
}

function Save-Shot {
    param([string]$Name)
    $remote = '/sdcard/calmobile-shot.png'
    # 注意：`-p` 需要转义，否则会被 PowerShell 当成脚本参数。
    & $adb shell screencap `-p $remote | Out-Null
    $target = Join-Path (Get-Location) "$Name.png"
    $directory = Split-Path $target -Parent
    if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    & $adb pull $remote $target | Out-Null
    & $adb shell rm $remote | Out-Null
    Write-Output "saved $target"
}

switch ($Action) {
    'install' {
        & $adb install -r $apk | Select-Object -Last 1
        Initialize-Reverse
    }
    # adb server 重启后映射会丢：调试中随时跑一次这条即可恢复，不用重新安装。
    'reverse' {
        Initialize-Reverse
    }
    'restart' {
        Initialize-Reverse
        & $adb shell am force-stop $package
        & $adb shell am start -n "$package/.WebShellActivity" | Out-Null
        Start-Sleep -Seconds 4
        Write-Output 'restarted'
    }
    'shot' {
        Save-Shot $Argument
    }
    'nodes' {
        Get-Nodes | Format-Table -AutoSize | Out-String -Width 200
    }
    'find' {
        Get-Nodes | Where-Object { $_.Text -like "*$Argument*" } | Format-Table -AutoSize | Out-String -Width 200
    }
    'tap-text' {
        $nodes = Get-Nodes
        $node = $nodes | Where-Object { $_.Text -eq $Argument -and $_.Clickable } | Select-Object -First 1
        if (-not $node) {
            $node = $nodes | Where-Object { $_.Text -eq $Argument } | Select-Object -Last 1
        }
        if (-not $node) {
            $node = $nodes | Where-Object { $_.Text -like "*$Argument*" } | Select-Object -First 1
        }
        if (-not $node) { throw "未找到文字：$Argument" }
        & $adb shell input tap $node.X $node.Y | Out-Null
        Write-Output "tap '$($node.Text)' at $($node.X),$($node.Y)"
        Start-Sleep -Seconds 2
    }
    'tap' {
        $parts = $Argument -split ','
        & $adb shell input tap ([int]$parts[0]) ([int]$parts[1]) | Out-Null
        Start-Sleep -Seconds 2
    }
    'back' {
        & $adb shell input keyevent 4 | Out-Null
        Start-Sleep -Seconds 2
    }
    'swipe-up' {
        & $adb shell input swipe 540 1800 540 700 260 | Out-Null
        Start-Sleep -Seconds 1
    }
    'logs' {
        & $adb logcat -d -s WebShellActivity:* AndroidRuntime:E chromium:E | Select-Object -Last 40
    }
    'motion' {
        # WebView 把系统的 animator_duration_scale=0 映射成 prefers-reduced-motion: reduce，
        # 于是 tokens.css 会把所有动画压成 0.01ms——现象就是「前端动效全没了」。
        # 那是设备开关而不是应用代码的问题，回归动效前先跑一次本动作。
        #   pwsh -File scripts\emu.ps1 motion          # 打开动画
        #   pwsh -File scripts\emu.ps1 motion check    # 只看当前状态
        $keys = 'animator_duration_scale', 'transition_animation_scale', 'window_animation_scale'
        $checkOnly = $Argument -eq 'check'
        foreach ($key in $keys) {
            if (-not $checkOnly) { & $adb shell settings put global $key 1 | Out-Null }
            $value = (& $adb shell settings get global $key).Trim()
            Write-Output "$key = $value"
        }
        if ($checkOnly) {
            Write-Output '（check 模式只读；去掉 check 即可全部置 1）'
        } else {
            Write-Output '已打开动画；应用需要重新进入页面才会重新读取该设置。'
        }
    }
    default {
        throw "未知操作：$Action"
    }
}
