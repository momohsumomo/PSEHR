# Hidden clinic host: API :5000 and UI :3010. No console windows.
param(
  [ValidateSet("start", "stop", "restart", "print", "protocol")]
  [string]$Action = "start",
  [string]$Url = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Py = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $Log | Out-Null

function Test-Listen([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400, $false)
    if ($ok -and $client.Connected) { $client.Close(); return $true }
    $client.Close()
  } catch {}
  return $false
}

function Stop-HostPorts {
  $ErrorActionPreference = "SilentlyContinue"
  foreach ($p in 5000, 3010) {
    Get-NetTCPConnection -LocalPort $p -State Listen | ForEach-Object {
      $procId = $_.OwningProcess
      if ($procId -and $procId -ne 0) { Stop-Process -Id $procId -Force }
    }
  }
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match "uvicorn src\.api\.main:app" -or
      $_.CommandLine -match "vite" -or
      $_.CommandLine -match "npm run dev"
    )
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 1
}

function Start-HiddenCmd([string]$WorkDir, [string]$Command, [string]$LogName) {
  $logFile = Join-Path $Log $LogName
  $bat = Join-Path $Log ($LogName + ".cmd")
  $body = "@echo off`r`ncd /d `"$WorkDir`"`r`n$Command >> `"$logFile`" 2>&1`r`n"
  Set-Content -Path $bat -Value $body -Encoding ASCII
  Start-Process -FilePath $bat -WorkingDirectory $WorkDir -WindowStyle Hidden | Out-Null
}

function Start-Api {
  if (Test-Listen 5000) { return }
  if (-not (Test-Path $Py)) { throw "Missing .venv. Run install-host first." }
  $env:PYTHONPATH = $Root
  Start-HiddenCmd $Root "set PYTHONPATH=$Root&& `"$Py`" -m uvicorn src.api.main:app --host 0.0.0.0 --port 5000" "api.log"
}

function Start-Ui {
  if (Test-Listen 3010) { return }
  $fe = Join-Path $Root "frontend"
  Start-HiddenCmd $fe "set VITE_ENABLE_API=true&& set VITE_API_BASE=/api&& npm run dev -- --host 0.0.0.0 --port 3010 --strictPort" "ui.log"
}

function Start-PrintAgent {
  if (Test-Listen 5310) { return }
  if (-not (Test-Path $Py)) { throw "Missing .venv. Run install-host or install-station first." }
  Start-HiddenCmd $Root "set PYTHONPATH=$Root&& `"$Py`" -m src.core.local_print_server" "print.log"
}

function Wait-Ready {
  for ($i = 0; $i -lt 45; $i++) {
    if ((Test-Listen 5000) -and (Test-Listen 3010)) { return }
    Start-Sleep -Seconds 1
  }
}

function Allow-Lan {
  $ErrorActionPreference = "SilentlyContinue"
  netsh advfirewall firewall show rule name="PSEHR-3010" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule name="PSEHR-3010" dir=in action=allow protocol=TCP localport=3010 profile=private | Out-Null
    netsh advfirewall firewall add rule name="PSEHR-5000" dir=in action=allow protocol=TCP localport=5000 profile=private | Out-Null
  }
}

function Invoke-Protocol([string]$Raw) {
  $text = "$Raw".ToLower()
  if ($text -match "sumatra") {
    if (Test-Path $Py) { & $Py -m src.core.local_print_server sumatra }
    Start-PrintAgent
    return
  }
  if ($text -match "print") {
    Start-PrintAgent
    return
  }
  if ($text -match "card") {
    $exe = Join-Path ${env:ProgramFiles(x86)} "NHI\cshis6\ciet6001s01.exe"
    if (Test-Path $exe) {
      Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null
    } else {
      Add-Content -Path (Join-Path $Log "protocol.log") -Value "card software 6.0 is not installed on this PC"
    }
  }
}

switch ($Action) {
  "stop" { Stop-HostPorts }
  "restart" {
    Stop-HostPorts
    Start-Api
    Start-Ui
    Allow-Lan
    Wait-Ready
  }
  "print" { Start-PrintAgent }
  "protocol" { Invoke-Protocol $Url }
  default {
    Start-Api
    Start-Ui
    Allow-Lan
    Wait-Ready
  }
}
