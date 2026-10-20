# Workstation tool. Installed on this PC. Reports printers, card software and VPN
# to the clinic site, and prints jobs the page hands to that site.
param(
  [switch]$Install,
  [switch]$Open,
  [switch]$Register
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $PSCommandPath
$Root = Join-Path $env:LOCALAPPDATA "PSEHR"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$Log = Join-Path $Root "desk.log"

function Write-Log([string]$Line) {
  try { Add-Content -Path $Log -Value ((Get-Date -Format "HH:mm:ss") + " " + $Line) -Encoding ASCII } catch {}
}

function Find-Edge {
  foreach ($raw in @(
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )) {
    if ($raw -and (Test-Path -LiteralPath $raw)) { return $raw }
  }
  return ""
}

function Find-Sumatra {
  $list = New-Object System.Collections.Generic.List[string]
  function Add-SumatraPath([string]$path) {
    if ($path -and -not $list.Contains($path)) { [void]$list.Add($path) }
  }
  Add-SumatraPath (Join-Path $Here "SumatraPDF.exe")
  Add-SumatraPath (Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe")
  Add-SumatraPath (Join-Path $env:LOCALAPPDATA "Wundadi\print\SumatraPDF.exe")
  if ($env:ProgramFiles) { Add-SumatraPath (Join-Path $env:ProgramFiles "SumatraPDF\SumatraPDF.exe") }
  $pf86 = ${env:ProgramFiles(x86)}
  if ($pf86) { Add-SumatraPath (Join-Path $pf86 "SumatraPDF\SumatraPDF.exe") }
  foreach ($root in @(
      "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe",
      "HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe",
      "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe"
    )) {
    try {
      $key = Get-Item -LiteralPath $root -ErrorAction Stop
      Add-SumatraPath "$($key.GetValue(''))"
    } catch {}
  }
  foreach ($raw in $list) {
    if ($raw -and (Test-Path -LiteralPath $raw)) { return $raw }
  }
  return ""
}

function Get-PrintSettings([double]$Width, [double]$Height, [string]$Feed) {
  $pageLandscape = $Width -gt ($Height + 2)
  $chosen = "$Feed".ToLower()
  $want = $pageLandscape
  if ($chosen -eq "landscape") { $want = $true }
  elseif ($chosen -eq "portrait") { $want = $false }
  $orient = "portrait"
  if ($want) { $orient = "landscape" }
  $lock = "noscale,disable-auto-rotation"
  if ($want -ne $pageLandscape) { $lock = "noscale" }
  $paper = ""
  if ([Math]::Abs($Width - 210) -le 2 -and [Math]::Abs($Height - 297) -le 2) { $paper = "paper=A4," }
  elseif ([Math]::Abs($Width - 297) -le 2 -and [Math]::Abs($Height - 210) -le 2) { $paper = "paper=A4," }
  elseif ([Math]::Abs($Width - 148) -le 2 -and [Math]::Abs($Height - 210) -le 2) { $paper = "paper=A5," }
  elseif ([Math]::Abs($Width - 210) -le 2 -and [Math]::Abs($Height - 148) -le 2) { $paper = "paper=A5," }
  if ($paper) { return $paper + $orient + "," + $lock }
  if ($chosen -eq "portrait" -or $chosen -eq "landscape") { return $orient + "," + $lock }
  return $lock
}

function Get-Card6 {
  $pf86 = ${env:ProgramFiles(x86)}
  if (-not $pf86) { $pf86 = "C:\Program Files (x86)" }
  $exe = Join-Path $pf86 "NHI\cshis6\ciet6001s01.exe"
  $installed = Test-Path -LiteralPath $exe
  $legacy = $false
  if (-not $installed) {
    $legacy = (Test-Path "C:\NHI") -or (Test-Path (Join-Path $pf86 "NHI\cshis")) -or (Test-Path (Join-Path $pf86 "NHI\CsHis"))
  }
  $running = $false
  if ($installed) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $iar = $client.BeginConnect("127.0.0.1", 5066, $null, $null)
      $ok = $iar.AsyncWaitHandle.WaitOne(400, $false) -and $client.Connected
      $client.Close()
      $running = [bool]$ok
    } catch { $running = $false }
  }
  return @{ installed = [bool]$installed; running = [bool]$running; legacy5 = [bool]$legacy }
}

function Test-DevicePrinter([string]$Name, [string]$PortName) {
  $port = "$PortName".ToUpper()
  if ($port.StartsWith("PORTPROMPT") -or $port.StartsWith("NUL") -or $port.StartsWith("FILE") -or $port.StartsWith("SHRFAX")) { return $false }
  $folded = "$Name".ToLower()
  if ($folded.Contains("pdf") -or $folded.Contains("xps") -or $folded.Contains("onenote") -or $folded.Contains("fax")) { return $false }
  return $true
}

function Get-PrinterRows {
  $rows = @()
  try { $items = @(Get-CimInstance -ClassName Win32_Printer) } catch { return @() }
  foreach ($item in $items) {
    $name = "$($item.Name)".Trim()
    if (-not $name) { continue }
    $status = 0
    try { $status = [int]$item.PrinterStatus } catch {}
    $online = (-not [bool]$item.WorkOffline) -and ($status -ne 7)
    $rows += @{
      name = $name
      online = [bool]$online
      default = [bool]$item.Default
      device = (Test-DevicePrinter $name "$($item.PortName)")
    }
  }
  return $rows
}

function Test-Vpn {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("medvpndc.nhi.gov.tw", 443, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1500, $false) -and $client.Connected
    $client.Close()
    return [bool]$ok
  } catch { return $false }
}

function Get-Health {
  return @{
    ok = $true
    edge = [bool](Find-Edge)
    sumatra = [bool](Find-Sumatra)
    printers = @(Get-PrinterRows)
    card6 = (Get-Card6)
    vpn = (Test-Vpn)
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

function Find-ClinicByPort {
  $self = @{}
  $addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike "127.*" -and $_.PrefixLength -ge 24 -and $_.PrefixLength -le 30 -and
    $_.InterfaceAlias -notmatch "vEthernet|WSL|Nord|VPN|Loopback|Hyper-V|Virtual"
  })
  $targets = New-Object System.Collections.Generic.List[string]
  foreach ($addr in $addrs) {
    $self[$addr.IPAddress] = $true
    $bytes = [System.Net.IPAddress]::Parse($addr.IPAddress).GetAddressBytes()
    [Array]::Reverse($bytes)
    $ipNum = [BitConverter]::ToUInt32($bytes, 0)
    $hostBits = 32 - [int]$addr.PrefixLength
    $block = ([uint32]1 -shl $hostBits) - 1
    $network = [uint32]($ipNum -band (-bnot [uint32]$block))
    for ($i = 1; $i -lt $block; $i++) {
      $n = [uint32]($network + [uint32]$i)
      $b = [BitConverter]::GetBytes($n)
      [Array]::Reverse($b)
      $text = ($b -join ".")
      if (-not $self.ContainsKey($text)) { [void]$targets.Add($text) }
    }
  }
  if ($targets.Count -eq 0) { return "" }
  $pending = @()
  foreach ($ip in $targets) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $iar = $client.BeginConnect($ip, 3010, $null, $null)
      $pending += @{ ip = $ip; client = $client; iar = $iar }
    } catch { $client.Close() }
  }
  $ready = (Get-Date).AddMilliseconds(800)
  while ((Get-Date) -lt $ready) { Start-Sleep -Milliseconds 50 }
  $hits = @()
  foreach ($item in $pending) {
    try {
      if ($item.iar.IsCompleted) {
        $item.client.EndConnect($item.iar)
        if ($item.client.Connected) { $hits += $item.ip }
      }
    } catch {}
    try { $item.client.Close() } catch {}
  }
  if ($hits.Count -eq 0) { return "" }
  $cached = ""
  $file = Join-Path $Root "host.txt"
  if (Test-Path $file) { $cached = (Get-Content $file -Raw).Trim() }
  if ($cached -and ($hits -contains $cached)) { return $cached }
  return [string](@($hits | Sort-Object { try { [version]$_ } catch { $_ } } | Select-Object -First 1))
}

function Find-ClinicHost {
  $file = Join-Path $Root "host.txt"
  if (Test-Path $file) {
    $cached = (Get-Content $file -Raw).Trim()
    if ($cached -and (Test-ClinicPage $cached)) { return $cached }
  }
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.EnableBroadcast = $true
  $udp.Client.ReceiveTimeout = 1200
  $payload = [Text.Encoding]::ASCII.GetBytes("PSEHR-HOST?")
  try { [void]$udp.Send($payload, $payload.Length, "255.255.255.255", 5301) } catch {}
  $deadline = (Get-Date).AddSeconds(2)
  while ((Get-Date) -lt $deadline) {
    try {
      $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
      $bytes = $udp.Receive([ref]$remote)
      $text = [Text.Encoding]::ASCII.GetString($bytes)
      if ($text -match "^PSEHR-HOST (\d+\.\d+\.\d+\.\d+)$" -and (Test-ClinicPage $Matches[1])) {
        Set-Content -Path $file -Value $Matches[1] -Encoding ASCII
        $udp.Close()
        return $Matches[1]
      }
    } catch { break }
  }
  $udp.Close()
  $scanned = Find-ClinicByPort
  if ($scanned) {
    Set-Content -Path $file -Value $scanned -Encoding ASCII
    return $scanned
  }
  return ""
}

function Open-ClinicEdge {
  param([string]$Page = "")
  $ip = Find-ClinicHost
  if (-not $ip) {
    Add-Type -AssemblyName System.Windows.Forms
    $codes = 0x627e,0x4e0d,0x5230,0x6b63,0x5728,0x958b,0x670d,0x52d9,0x7684,0x4e3b,0x6a5f,0x3002
    $msg = -join ($codes | ForEach-Object { [char]$_ })
    [System.Windows.Forms.MessageBox]::Show($msg, "PSEHR") | Out-Null
    return
  }
  $url = "http://{0}:3010/?desk=1" -f $ip
  if ($Page) { $url = "http://{0}:3010/{1}?desk=1" -f $ip, $Page.Trim("/") }
  $edge = Find-Edge
  if ($edge) {
    $profile = Join-Path $Root "edge-app"
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $edgeArgs = "--user-data-dir=`"$profile`" --app=`"$url`" --no-first-run --no-default-browser-check --disable-sync --disable-features=LocalNetworkAccessChecks"
    Start-Process -FilePath $edge -ArgumentList $edgeArgs
  } else { Start-Process $url }
}

function Invoke-DeskJson([string]$Url, [string]$Method, [string]$Json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Json)
  return Invoke-RestMethod -Uri $Url -Method $Method -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 8
}

function Invoke-OnePrint($job) {
  $printer = "$($job.printerName)".Trim()
  $html = "$($job.html)"
  if (-not $printer -or -not $html.Trim()) { throw "missing printer or html" }
  $exe = Find-Sumatra
  if (-not $exe) { throw "SumatraPDF is not installed" }
  $edge = Find-Edge
  if (-not $edge) { throw "Edge is not installed" }
  $dir = Join-Path $env:TEMP ("psehr-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $htmlPath = Join-Path $dir "slip.html"
  $pdf = Join-Path $dir "slip.pdf"
  [IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding $false))
  $uri = (New-Object System.Uri ([string]$htmlPath)).AbsoluteUri
  & $edge --headless=new --disable-gpu --no-first-run --print-to-pdf="$pdf" $uri | Out-Null
  $waited = 0
  while (-not (Test-Path -LiteralPath $pdf) -and $waited -lt 40) { Start-Sleep -Milliseconds 250; $waited++ }
  if (-not (Test-Path -LiteralPath $pdf)) { throw "pdf was not created" }
  $width = 0.0
  $height = 0.0
  try { $width = [double]$job.widthMm } catch {}
  try { $height = [double]$job.heightMm } catch {}
  $settings = Get-PrintSettings $width $height "$($job.feed)"
  & $exe -silent -print-to $printer -print-settings $settings -exit-when-done $pdf | Out-Null
}

function Start-DeskLoop {
  Stop-OldAgent
  $mutex = New-Object System.Threading.Mutex($false, "Local\PSEHR-desk-agent")
  $owned = $false
  try {
    $owned = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $owned = $true
  }
  if (-not $owned) { return }
  try {
    while ($true) {
      try {
        $ip = Find-ClinicHost
        if ($ip) {
          $health = Get-Health | ConvertTo-Json -Depth 6 -Compress
          Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/report" -f $ip) "POST" $health | Out-Null
          $pending = Invoke-RestMethod -Uri ("http://{0}:3010/api/clinic/desk/jobs" -f $ip) -TimeoutSec 8
          foreach ($job in @($pending.jobs)) {
            if (-not $job -or -not $job.id) { continue }
            try {
              Invoke-OnePrint $job
              $done = @{ ok = $true; printer = "$($job.printerName)" } | ConvertTo-Json -Compress
              Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/jobs/{1}" -f $ip, $job.id) "POST" $done | Out-Null
            } catch {
              $fail = @{ ok = $false; detail = $_.Exception.Message } | ConvertTo-Json -Compress
              try { Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/jobs/{1}" -f $ip, $job.id) "POST" $fail | Out-Null } catch {}
              Write-Log $_.Exception.Message
            }
          }
        }
      } catch { Write-Log $_.Exception.Message }
      Start-Sleep -Seconds 4
    }
  } finally {
    $mutex.ReleaseMutex() | Out-Null
  }
}

function Stop-OldAgent {
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $procs) {
      if ([int]$proc.ProcessId -eq $PID) { continue }
      $cmd = "$($proc.CommandLine)"
      if ($cmd -like "*-Open*" -or $cmd -like "*-Install*") { continue }
      if ($cmd -like "*desk_agent.ps1*" -or $cmd -like "*desk_helper.ps1*") {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

if ($Open -or $Install -or $Register) {
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  Start-Process -FilePath $ps -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`"" -WindowStyle Hidden
  if ($Register) { Open-ClinicEdge -Page "kiosk/register" }
  else { Open-ClinicEdge }
  exit 0
}

Start-DeskLoop
