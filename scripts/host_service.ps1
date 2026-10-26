# Hidden clinic host: API :5000 and UI :3010. No console windows.
param(
  [ValidateSet("start", "stop", "restart", "print", "protocol", "beacon", "discover", "firewall", "autostart")]
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

function Stop-ListenerPid([int]$procId) {
  if (-not $procId -or $procId -le 4) { return }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ParentProcessId -eq $procId } |
    ForEach-Object { Stop-ListenerPid ([int]$_.ProcessId) }
  $ErrorActionPreference = "SilentlyContinue"
  taskkill /F /T /PID $procId | Out-Null
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

function Close-HostWindows {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match "API :5000|UI :3010"
  } | ForEach-Object { $_.CloseMainWindow() | Out-Null }
}

function Stop-HostPorts {
  $ErrorActionPreference = "SilentlyContinue"
  foreach ($p in 5000, 3010) {
    $conns = @()
    try { $conns = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) } catch { $conns = @() }
    foreach ($conn in $conns) {
      Stop-ListenerPid ([int]$conn.OwningProcess)
    }
  }
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match "uvicorn src\.api\.main:app" -or
      $_.CommandLine -match "vite" -or
      $_.CommandLine -match "npm run dev" -or
      $_.CommandLine -match "scripts\\start_api\.bat" -or
      $_.CommandLine -match "scripts\\start_ui\.bat" -or
      ($_.CommandLine -match "host_service\.ps1" -and $_.CommandLine -match "-Action beacon")
    )
  } | ForEach-Object { Stop-ListenerPid ([int]$_.ProcessId) }
  Close-HostWindows
  Start-Sleep -Seconds 2
  $left = @()
  foreach ($p in 5000, 3010) {
    try {
      Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -and $_.OwningProcess -gt 4) { $left += [int]$_.OwningProcess }
      }
    } catch {}
  }
  $left = @($left | Select-Object -Unique)
  if ($left.Count -gt 0) {
    $arg = ($left | ForEach-Object { "taskkill /F /T /PID $_" }) -join "; "
    $arg += "; Get-Process | Where-Object { `$_.MainWindowTitle -match 'API :5000|UI :3010' } | ForEach-Object { `$_.CloseMainWindow() | Out-Null }"
    Start-Process -FilePath "powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command $arg"
    Start-Sleep -Seconds 1
  }
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

function Register-DeskHook {
  $vbs = Join-Path $Root "scripts\psehr_protocol.vbs"
  if (-not (Test-Path $vbs)) { return }
  $cmd = "wscript.exe //nologo `"$vbs`" `"%1`""
  New-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Force | Out-Null
  Set-Item -Path "HKCU:\Software\Classes\psehr" -Value "URL:PSEHR"
  New-ItemProperty -Path "HKCU:\Software\Classes\psehr" -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
  Set-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Value $cmd
}

function Resolve-Python {
  $candidates = @()
  if (Test-Path $Py) { $candidates += $Py }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  foreach ($exe in $candidates) {
    & $exe -c "import sys" 2>$null
    if ($LASTEXITCODE -eq 0) { return $exe }
  }
  return ""
}

function Test-FreshPrintAgent {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:5310/health" -UseBasicParsing -TimeoutSec 2
    return $res.Content -match '"card6"'
  } catch { return $false }
}

function Stop-PythonPrintServer {
  $removed = $false
  $conns = @(Get-NetTCPConnection -LocalPort 5310 -State Listen -ErrorAction SilentlyContinue)
  foreach ($conn in $conns) {
    $procId = [int]$conn.OwningProcess
    if ($procId -le 4) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -match "local_print_server") {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      $removed = $true
    }
  }
  if ($removed) { Start-Sleep -Seconds 1 }
}

function Start-PrintAgent {
  Register-DeskHook
  if (Test-Listen 5310) { Stop-PythonPrintServer }
  if ((Test-Listen 5310) -and (Test-FreshPrintAgent)) { return }
  if (Test-Listen 5310) { return }
  $client = -join @([char]0x5BA2, [char]0x6236, [char]0x7AEF)
  $agent = Join-Path $Root (Join-Path $client "desk_agent.ps1")
  if (-not (Test-Path -LiteralPath $agent)) {
    Write-HostLog "desk agent missing"
    return
  }
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  Start-Process -FilePath $ps -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agent`"" | Out-Null
}

function Write-HostLog([string]$line) {
  $path = Join-Path $Log "host-restart.log"
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $path -Value "$stamp $line" -Encoding ASCII
}

function Show-HostFail {
  $msg = -join @(
    [char]0x9580, [char]0x8A3A, [char]0x6C92, [char]0x6709, [char]0x958B, [char]0x8D77, [char]0x4F86, [char]0x3002,
    [char]0x8ACB, [char]0x518D, [char]0x6309, [char]0x4E00, [char]0x6B21, [char]0x555F, [char]0x52D5, [char]0x3002
  )
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show($msg, "PSEHR") | Out-Null
  } catch {}
}

function Wait-Ready {
  for ($i = 0; $i -lt 90; $i++) {
    if ((Test-Listen 5000) -and (Test-Listen 3010)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Register-HostAutostart {
  $vbs = Join-Path $Root "scripts\autostart_host.vbs"
  if (-not (Test-Path -LiteralPath $vbs)) { return }
  try {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//nologo `"$vbs`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $trigger.Delay = "PT20S"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName "PSEHR-host" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-HostLog "autostart registered"
  } catch {
    Write-HostLog ("autostart task " + $_.Exception.Message)
    $startup = [Environment]::GetFolderPath("Startup")
    $linkPath = Join-Path $startup "PSEHR-host.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = "wscript.exe"
    $link.Arguments = "//nologo `"$vbs`""
    $link.WorkingDirectory = $Root
    $link.WindowStyle = 7
    $link.Save()
  }
}

function Start-HostPair {
  if (Test-Listen 5000) { Write-HostLog "api port already up" } else { Start-Api; Write-HostLog "api launched" }
  if (Test-Listen 3010) { Write-HostLog "ui port already up" } else { Start-Ui; Write-HostLog "ui launched" }
  Start-Beacon
  Allow-Lan
  if (-not (Wait-Ready)) {
    Write-HostLog "ports not listening"
    Show-HostFail
    exit 1
  }
  Write-HostLog "ready"
}

function Allow-Lan {
  $ErrorActionPreference = "SilentlyContinue"
  foreach ($rule in @(
      @{ Name = "PSEHR-3010"; Protocol = "TCP"; Port = "3010" },
      @{ Name = "PSEHR-5000"; Protocol = "TCP"; Port = "5000" },
      @{ Name = "PSEHR-5301"; Protocol = "UDP"; Port = "5301" }
    )) {
    netsh advfirewall firewall show rule name="$($rule.Name)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      netsh advfirewall firewall add rule name="$($rule.Name)" dir=in action=allow protocol=$($rule.Protocol) localport=$($rule.Port) profile=domain,private | Out-Null
    }
  }
}

function Test-ClinicPage([string]$ip) {
  if (-not $ip) { return $false }
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($ip, 3010, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500, $false) -and $client.Connected
    $client.Close()
    return [bool]$ok
  } catch { return $false }
}

function Test-SameSubnet([string]$ipText, [int]$prefix, [string]$peer) {
  $parts = $ipText.Split(".") | ForEach-Object { [int64]$_ }
  $mine = ($parts[0] -shl 24) -bor ($parts[1] -shl 16) -bor ($parts[2] -shl 8) -bor $parts[3]
  $pp = $peer.Split(".") | ForEach-Object { [int64]$_ }
  $other = ($pp[0] -shl 24) -bor ($pp[1] -shl 16) -bor ($pp[2] -shl 8) -bor $pp[3]
  $block = (([int64]1 -shl (32 - $prefix)) - 1)
  $mask = -bnot $block
  return (($mine -band $mask) -eq ($other -band $mask))
}

function Get-ClinicIpv4([string]$peer) {
  $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
      $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and
      $_.InterfaceAlias -notmatch "vEthernet|WSL|Nord|VPN|Loopback|Hyper-V|Virtual"
    })
  if ($peer -and $peer -notlike "127.*") {
    foreach ($row in $rows) {
      if (Test-SameSubnet $row.IPAddress ([int]$row.PrefixLength) $peer) { return [string]$row.IPAddress }
    }
  }
  if ($rows.Count -gt 0) { return [string]$rows[0].IPAddress }
  return ""
}

function Get-LanBroadcasts {
  $list = New-Object System.Collections.Generic.List[string]
  $list.Add("255.255.255.255")
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike "127.*" -and $_.PrefixLength -ge 8 -and $_.PrefixLength -le 30 -and
    $_.InterfaceAlias -notmatch "vEthernet|WSL|Nord|VPN|Loopback|Hyper-V|Virtual"
  } | ForEach-Object {
    $parts = $_.IPAddress.Split(".") | ForEach-Object { [int64]$_ }
    $ip = ($parts[0] -shl 24) -bor ($parts[1] -shl 16) -bor ($parts[2] -shl 8) -bor $parts[3]
    $block = (([int64]1 -shl (32 - [int]$_.PrefixLength)) - 1)
    $bcast = $ip -bor $block
    $text = "$((($bcast -shr 24) -band 255)).$((($bcast -shr 16) -band 255)).$((($bcast -shr 8) -band 255)).$($bcast -band 255)"
    if (-not $list.Contains($text)) { $list.Add($text) }
  }
  return $list
}

function Start-Beacon {
  $already = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match "host_service\.ps1" -and $_.CommandLine -match "-Action beacon"
  }
  if ($already) { return }
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -WorkingDirectory $Root -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Root "scripts\host_service.ps1"), "-Action", "beacon"
  )
}

function Invoke-Beacon {
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket, [Net.Sockets.SocketOptionName]::ReuseAddress, $true)
  $udp.Client.Bind((New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 5301)))
  $udp.EnableBroadcast = $true
  while ($true) {
    $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
    $bytes = $udp.Receive([ref]$remote)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    if ($text -ne "PSEHR-HOST?") { continue }
    $ip = Get-ClinicIpv4 ([string]$remote.Address)
    if (-not $ip) { continue }
    $reply = [Text.Encoding]::ASCII.GetBytes("PSEHR-HOST $ip")
    [void]$udp.Send($reply, $reply.Length, $remote)
  }
}

function Save-DiscoveredHost([string]$ip) {
  $dir = Join-Path $env:LOCALAPPDATA "PSEHR"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Set-Content -Path (Join-Path $dir "host.txt") -Value $ip.Trim() -Encoding ASCII
}

function Find-ClinicHost {
  $hostFile = Join-Path $env:LOCALAPPDATA "PSEHR\host.txt"
  if (Test-Path $hostFile) {
    $cached = (Get-Content $hostFile -Raw).Trim()
    if ($cached -and (Test-ClinicPage $cached)) { return $cached }
  }
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.EnableBroadcast = $true
  $udp.Client.ReceiveTimeout = 1500
  $payload = [Text.Encoding]::ASCII.GetBytes("PSEHR-HOST?")
  foreach ($dest in (Get-LanBroadcasts)) {
    try { [void]$udp.Send($payload, $payload.Length, $dest, 5301) } catch {}
  }
  $deadline = (Get-Date).AddSeconds(2)
  while ((Get-Date) -lt $deadline) {
    try {
      $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
      $bytes = $udp.Receive([ref]$remote)
      $text = [Text.Encoding]::ASCII.GetString($bytes)
      if ($text -match "^PSEHR-HOST (\d+\.\d+\.\d+\.\d+)$") {
        $ip = $Matches[1]
        if (Test-ClinicPage $ip) { return $ip }
      }
    } catch { break }
  }
  return ""
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
    try {
      Write-HostLog "restart begin"
      Stop-HostPorts
      Write-HostLog "stopped"
      Start-HostPair
    } catch {
      Write-HostLog ("fail " + $_.Exception.Message)
      Show-HostFail
      exit 1
    }
  }
  "print" { Start-PrintAgent }
  "protocol" { Invoke-Protocol $Url }
  "beacon" { Invoke-Beacon }
  "firewall" { Allow-Lan }
  "autostart" { Register-HostAutostart }
  "discover" {
    $ip = Find-ClinicHost
    if (-not $ip) { exit 1 }
    Save-DiscoveredHost $ip
    Write-Output $ip
  }
  default {
    try {
      Write-HostLog "start begin"
      Register-HostAutostart
      $mutex = New-Object System.Threading.Mutex($false, "Local\PSEHR-host-start")
      $owned = $false
      try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
      if (-not $owned) { Write-HostLog "start already running"; exit 0 }
      try { Start-HostPair } finally { $mutex.ReleaseMutex() | Out-Null }
    } catch {
      Write-HostLog ("fail " + $_.Exception.Message)
      Show-HostFail
      exit 1
    }
  }
}
