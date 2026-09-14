# 模拟器回归辅助脚本：安装 APK、截图、按可见文字点击。
# 用法示例：
#   pwsh -File scripts\emu.ps1 install
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

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & $adb @Args
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
    }
    'restart' {
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
    default {
        throw "未知操作：$Action"
    }
}
