# 健保署讀卡機控制軟體 6.0 主控台固定聽 https://localhost:5066。
# Windows 10 若「動態 TCP 埠」從 1025 起跳，Hyper-V / WinNAT 會把 5066–5165 劃進排除範圍，
# 主控台行程能起來（工作列隱藏圖示）但 API 綁不上 → 雙擊看起來像沒開。
$ErrorActionPreference = "Continue"
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $self = $MyInvocation.MyCommand.Path
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $self
    )
    exit 0
}

$logDir = Join-Path $PSScriptRoot "..\data"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "nhi-cshis6-port-fix.log"
$sentinel = Join-Path $logDir "nhi-cshis6-port-fix.done"

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Host $line
}

function Test-PortExcluded([int]$port) {
    $raw = netsh int ipv4 show excludedportrange protocol=tcp | Out-String
    foreach ($line in ($raw -split "`r?`n")) {
        if ($line -match "^\s*(\d+)\s+(\d+)") {
            $start = [int]$Matches[1]
            $end = [int]$Matches[2]
            if ($port -ge $start -and $port -le $end) { return $true }
        }
    }
    return $false
}

function Test-PortListening([int]$port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conns
}

Remove-Item $sentinel -ErrorAction SilentlyContinue
"==== start ====" | Set-Content -Path $log -Encoding UTF8
Write-Log "dynamic TCP: $((netsh int ipv4 show dynamicport tcp) -join ' | ')"
Write-Log ("5066 excluded before fix: {0}" -f (Test-PortExcluded 5066))

Write-Log "Set IANA ephemeral range (tcp/udp 49152-65535) so Hyper-V stops eating 5066"
netsh int ipv4 set dynamicport tcp start=49152 num=16384 | Out-Null
netsh int ipv4 set dynamicport udp start=49152 num=16384 | Out-Null

Write-Log "Restart WinNAT / HNS so excluded ranges rebuild"
net stop winnat 2>&1 | ForEach-Object { Write-Log "net stop winnat: $_" }
Start-Sleep -Seconds 2
try { Restart-Service hns -Force -ErrorAction Stop; Write-Log "hns restarted" }
catch { Write-Log "hns restart skipped: $($_.Exception.Message)" }
net start winnat 2>&1 | ForEach-Object { Write-Log "net start winnat: $_" }
Start-Sleep -Seconds 2

$excluded = Test-PortExcluded 5066
Write-Log ("5066 excluded after rebuild: {0}" -f $excluded)
if ($excluded) {
    Write-Log "WinNAT still holding 5066 — leave WinNAT stopped so the console can bind"
    net stop winnat 2>&1 | ForEach-Object { Write-Log "net stop winnat (2): $_" }
    Start-Sleep -Seconds 2
    Write-Log ("5066 excluded with WinNAT stopped: {0}" -f (Test-PortExcluded 5066))
}

Get-Process ciet6001s01, cies6001s04 -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log "killing leftover $($_.ProcessName) pid $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

$exe = "${env:ProgramFiles(x86)}\NHI\cshis6\ciet6001s01.exe"
if (-not (Test-Path $exe)) {
    Write-Log "MISSING $exe"
    Set-Content -Path $sentinel -Value "missing-exe" -Encoding UTF8
    exit 2
}

Write-Log "Start Smart Card service (PC/SC); domain join often leaves it stopped"
try {
    Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction Stop
    Start-Service SCardSvr -ErrorAction Stop
    Write-Log "SCardSvr running"
} catch {
    Write-Log "SCardSvr start failed: $($_.Exception.Message)"
}
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Write-Log "console pid $($p.Id)"

$ok = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PortListening 5066) { $ok = $true; Write-Log "5066 LISTEN after ${i}s"; break }
}
if (-not $ok) {
    Write-Log "5066 still not listening"
    netstat -ano | Select-String "5066" | ForEach-Object { Write-Log $_.Line }
    Get-Process -Id $p.Id -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Log ("process still running WS={0} MainWindow={1}" -f $_.WorkingSet64, $_.MainWindowHandle)
    }
}

try { net start winnat | Out-Null; Write-Log "WinNAT started after bind attempt" }
catch { Write-Log "WinNAT start after bind: $($_.Exception.Message)" }

$status = if ($ok) { "listen-ok" } else { "listen-fail" }
Set-Content -Path $sentinel -Value $status -Encoding UTF8
Write-Log "done status=$status"
if (-not $ok) { exit 1 }
exit 0
