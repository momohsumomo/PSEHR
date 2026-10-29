param(
  [ValidateSet("ensure", "ensure6", "restart6", "restart5", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Continue"

function Test-ShieldFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($Path))
  } catch { return $false }
  return $text.Contains("reader-block.log")
}

function Get-SixExe {
  $pf86 = ${env:ProgramFiles(x86)}
  if (-not $pf86) { $pf86 = "C:\Program Files (x86)" }
  return (Join-Path $pf86 "NHI\cshis6\ciet6001s01.exe")
}

function Test-SixPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect("127.0.0.1", 5066, $null, $null)
    return ($wait.AsyncWaitHandle.WaitOne(400, $false) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

function Test-FiveBlocked {
  $five = @(Get-Process -Name "csfsim" -ErrorAction SilentlyContinue)
  if ($five.Count -eq 0) { return $false }
  $ps32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps32)) { return $false }
  $procId = [int]$five[0].Id
  $mod = & $ps32 -NoProfile -Command "(Get-Process -Id $procId).Modules | Where-Object { `$_.ModuleName -eq 'WinSCard.dll' } | Select-Object -ExpandProperty FileName"
  return ("$mod".Trim().ToLower() -eq "c:\nhi\bin\winscard.dll")
}

function Stop-FiveProcess {
  Get-Process -Name "csfsim" -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 500
}

function Install-Shield {
  $destDir = "C:\NHI\BIN"
  $dest = Join-Path $destDir "WinSCard.dll"
  $orig = Join-Path $destDir "WinSCard_orig.dll"
  $sys = Join-Path $env:SystemRoot "SysWOW64\WinSCard.dll"
  $packed = Join-Path $PSScriptRoot "reader-block\WinSCard.dll"
  if (-not (Test-Path -LiteralPath $destDir)) { return "nobin" }
  if (-not (Test-Path -LiteralPath $packed)) {
    if (Test-ShieldFile $dest) { return "ok" }
    return "nopack"
  }
  $alive = @(Get-Process -Name "csfsim" -ErrorAction SilentlyContinue)
  if ($alive.Count -gt 0) {
    if (Test-FiveBlocked) { return "ok" }
    Stop-FiveProcess
  }
  try {
    if (-not (Test-ShieldFile $dest)) {
      Copy-Item -LiteralPath $packed -Destination $dest -Force
    }
    if (-not (Test-Path -LiteralPath $orig) -and (Test-Path -LiteralPath $sys)) {
      Copy-Item -LiteralPath $sys -Destination $orig -Force
    }
  } catch { return "copy" }
  if (Test-ShieldFile $dest) { return "ok" }
  return "copy"
}

function Start-FiveChecked {
  $exe = "C:\NHI\BIN\csfsim.exe"
  if (-not (Test-Path -LiteralPath $exe)) { return "missing" }
  $shield = Install-Shield
  if ($shield -ne "ok") { return ("shield-" + $shield) }
  $alive = @(Get-Process -Name "csfsim" -ErrorAction SilentlyContinue)
  if ($alive.Count -gt 0 -and (Test-FiveBlocked)) { return "running" }
  if ($alive.Count -gt 0) { Stop-FiveProcess }
  $shield = Install-Shield
  if ($shield -ne "ok") { return ("shield-" + $shield) }
  Start-Process -FilePath $exe -WorkingDirectory "C:\NHI\BIN" | Out-Null
  Start-Sleep -Seconds 2
  if (-not (Test-FiveBlocked)) {
    Stop-FiveProcess
    return "shield-load"
  }
  return "started"
}

function Start-SixChecked {
  $exe = Get-SixExe
  if (-not (Test-Path -LiteralPath $exe)) { return "missing" }
  if (Test-SixPort) { return "running" }
  $alive = @(Get-Process -Name "ciet6001s01" -ErrorAction SilentlyContinue)
  if ($alive.Count -eq 0) {
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null
  }
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-SixPort) { return "started" }
    Start-Sleep -Seconds 1
  }
  if (Test-SixPort) { return "started" }
  return "down"
}

function Restart-SixChecked {
  $exe = Get-SixExe
  if (-not (Test-Path -LiteralPath $exe)) { return "missing" }
  foreach ($name in @("ciet6001s01", "cies6001s04")) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Start-Sleep -Milliseconds 600
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-SixPort) { return "started" }
    Start-Sleep -Seconds 1
  }
  if (Test-SixPort) { return "started" }
  return "down"
}

function Restart-FiveChecked {
  $exe = "C:\NHI\BIN\csfsim.exe"
  if (-not (Test-Path -LiteralPath $exe)) { return "missing" }
  Stop-FiveProcess
  $shield = Install-Shield
  if ($shield -ne "ok") { return ("shield-" + $shield) }
  Start-Process -FilePath $exe -WorkingDirectory "C:\NHI\BIN" | Out-Null
  Start-Sleep -Seconds 2
  if (-not (Test-FiveBlocked)) {
    Stop-FiveProcess
    return "shield-load"
  }
  return "started"
}

$sixResult = ""
$fiveResult = ""
if ($Action -eq "ensure" -or $Action -eq "ensure6" -or $Action -eq "status") {
  if ($Action -eq "ensure") {
    $sixResult = Start-SixChecked
    $fiveResult = Start-FiveChecked
  } elseif ($Action -eq "ensure6") {
    $sixResult = Start-SixChecked
  }
} elseif ($Action -eq "restart6") {
  $sixResult = Restart-SixChecked
} elseif ($Action -eq "restart5") {
  $fiveResult = Restart-FiveChecked
}

$card6Installed = Test-Path -LiteralPath (Get-SixExe)
$fiveInstalled = Test-Path -LiteralPath "C:\NHI\BIN\csfsim.exe"
$card6Running = Test-SixPort
$fiveRunning = @(Get-Process -Name "csfsim" -ErrorAction SilentlyContinue).Count -gt 0
$shield = Test-ShieldFile "C:\NHI\BIN\WinSCard.dll"
if ($fiveRunning -and (Test-FiveBlocked)) { $shield = $true }

function Bit([bool]$Value) { if ($Value) { return "true" } else { return "false" } }

Write-Output ('{"ok":true,"action":"' + $Action + '","card6Installed":' + (Bit $card6Installed) + ',"card6Running":' + (Bit $card6Running) + ',"fiveInstalled":' + (Bit $fiveInstalled) + ',"fiveRunning":' + (Bit $fiveRunning) + ',"shield":' + (Bit $shield) + ',"sixResult":"' + $sixResult + '","fiveResult":"' + $fiveResult + '"}')
