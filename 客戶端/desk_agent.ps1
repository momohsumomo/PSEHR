# Workstation tool. Installed on this PC. Reports printers, card software and VPN
# to the clinic site, and prints jobs the page hands to that site.
param(
  [switch]$Install,
  [switch]$Open,
  [switch]$Register,
  [switch]$Intake
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

function Format-Mm([double]$Value) {
  return $Value.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
}

function Convert-SlipForFeed([string]$Html, [double]$Width, [double]$Height, [string]$Feed) {
  $chosen = "$Feed".ToLower()
  if ($chosen -eq "portrait" -and $Width -gt ($Height + 2)) {
    $short = Format-Mm $Height
    $long = Format-Mm $Width
    $style = '<style id="ys-short-edge">@page{size:' + $short + 'mm ' + $long + 'mm;margin:0 !important;}html,body{margin:0 !important;padding:0 !important;width:' + $short + 'mm !important;height:' + $long + 'mm !important;overflow:hidden !important;background:#fff !important;}.ys-rot{width:' + $long + 'mm;height:' + $short + 'mm;transform-origin:top left;transform:rotate(90deg) translateY(-' + $short + 'mm);}</style>'
    $head = $Html.IndexOf("</head>")
    if ($head -ge 0) { $Html = $Html.Substring(0, $head) + $style + $Html.Substring($head) }
    else { $Html = $style + $Html }
    $lower = $Html.ToLower()
    $start = $lower.IndexOf("<body")
    if ($start -lt 0) {
      $Html = '<div class="ys-rot">' + $Html + "</div>"
    } else {
      $openEnd = $Html.IndexOf(">", $start)
      $close = $lower.LastIndexOf("</body>")
      if ($openEnd -ge 0 -and $close -gt $openEnd) {
        $Html = $Html.Substring(0, $openEnd + 1) + '<div class="ys-rot">' + $Html.Substring($openEnd + 1, $close - ($openEnd + 1)) + "</div>" + $Html.Substring($close)
      }
    }
    return @{ Html = $Html; Width = $Height; Height = $Width; Feed = "portrait" }
  }
  return @{ Html = $Html; Width = $Width; Height = $Height; Feed = $chosen }
}

function Stop-PrintEdge {
  if ($script:PrintWs) { try { $script:PrintWs.Dispose() } catch {} }
  $script:PrintWs = $null
  if ($script:PrintEdge -and -not $script:PrintEdge.HasExited) {
    try { Stop-Process -Id $script:PrintEdge.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  $script:PrintEdge = $null
  if ($script:PrintOut) { try { $script:PrintOut.Dispose() } catch {} }
  if ($script:PrintErr) { try { $script:PrintErr.Dispose() } catch {} }
  $script:PrintOut = $null
  $script:PrintErr = $null
}

function Send-PrintCdp([string]$Json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList (, $bytes)
  $send = $script:PrintWs.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None)
  if (-not $send.Wait(8000)) { throw "edge send timeout" }
}

function Read-PrintCdp {
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 131072
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList (, $buf)
    $task = $script:PrintWs.ReceiveAsync($seg, [Threading.CancellationToken]::None)
    if (-not $task.Wait(20000)) { throw "edge read timeout" }
    $got = $task.Result
    if ($got.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "edge closed" }
    $ms.Write($buf, 0, $got.Count)
  } while (-not $got.EndOfMessage)
  return [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

function Call-PrintCdp([string]$Method, [string]$ParamsJson) {
  if (-not $script:PrintCdp) { $script:PrintCdp = 0 }
  $script:PrintCdp++
  $id = $script:PrintCdp
  if ($ParamsJson) { $json = '{"id":' + $id + ',"method":"' + $Method + '","params":' + $ParamsJson + '}' }
  else { $json = '{"id":' + $id + ',"method":"' + $Method + '"}' }
  Send-PrintCdp $json
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $text = Read-PrintCdp
    if ($text -notmatch ('"id"\s*:\s*' + $id + '\D')) { continue }
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 67108864
    $ser.RecursionLimit = 20
    $msg = $ser.DeserializeObject($text)
    if ($msg["error"]) { throw "edge refused the page" }
    return $msg["result"]
  }
  throw "edge reply timeout"
}

function Ensure-PrintEdge([string]$Edge) {
  if ($script:PrintEdge -and -not $script:PrintEdge.HasExited -and $script:PrintWs -and $script:PrintWs.State -eq [System.Net.WebSockets.WebSocketState]::Open) { return }
  Stop-PrintEdge
  if (-not $Edge) { throw "Edge is not installed" }
  $profile = Join-Path $env:LOCALAPPDATA "PSEHR\print-edge"
  Stop-ProfileEdge $profile
  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  $marker = Join-Path $profile "DevToolsActivePort"
  if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Edge
  $psi.Arguments = "--headless=new --disable-gpu --no-first-run --no-default-browser-check --disable-extensions --disable-sync --remote-allow-origins=* --user-data-dir=`"$profile`" --remote-debugging-port=0 about:blank"
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $script:PrintEdge = $proc
  $script:PrintOut = [System.IO.File]::Create((Join-Path $profile "out.txt"))
  $script:PrintErr = [System.IO.File]::Create((Join-Path $profile "err.txt"))
  $null = $proc.StandardOutput.BaseStream.CopyToAsync($script:PrintOut)
  $null = $proc.StandardError.BaseStream.CopyToAsync($script:PrintErr)
  $deadline = (Get-Date).AddSeconds(15)
  $port = 0
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { throw "edge exited" }
    if (Test-Path -LiteralPath $marker) {
      $line = @(Get-Content -LiteralPath $marker -ErrorAction SilentlyContinue)[0]
      if ($line -match "^\d+$") { $port = [int]$line; break }
    }
    Start-Sleep -Milliseconds 50
  }
  if ($port -le 0) { throw "edge debug port missing" }
  $wsUrl = ""
  $lookUntil = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $lookUntil -and -not $wsUrl) {
    try { $pages = @(Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $port) -TimeoutSec 5) } catch { $pages = @() }
    foreach ($page in $pages) {
      if ("$($page.type)" -eq "page" -and $page.webSocketDebuggerUrl) { $wsUrl = [string]$page.webSocketDebuggerUrl; break }
    }
    if (-not $wsUrl) { Start-Sleep -Milliseconds 100 }
  }
  if (-not $wsUrl) { throw "edge page missing" }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $connect = $ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None)
  if (-not $connect.Wait(8000)) { throw "edge socket timeout" }
  if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) { throw "edge socket missing" }
  $script:PrintWs = $ws
  $script:PrintCdp = 0
  Call-PrintCdp "Page.enable" "{}" | Out-Null
}

function Export-EdgePdf([string]$Edge, [string]$HtmlPath, [string]$PdfPath, [double]$WidthMm, [double]$HeightMm) {
  if ($WidthMm -le 0) { $WidthMm = 210 }
  if ($HeightMm -le 0) { $HeightMm = 297 }
  $attempt = 0
  while ($attempt -lt 2) {
    $attempt++
    try {
      Ensure-PrintEdge $Edge
      $uri = (New-Object System.Uri ([string]$HtmlPath)).AbsoluteUri
      $uriJson = ($uri | ConvertTo-Json -Compress)
      Call-PrintCdp "Page.navigate" ('{"url":' + $uriJson + '}') | Out-Null
      $readyDeadline = (Get-Date).AddSeconds(8)
      while ((Get-Date) -lt $readyDeadline) {
        $state = Call-PrintCdp "Runtime.evaluate" '{"expression":"document.readyState","returnByValue":true}'
        if ($state -and $state["result"] -and "$($state["result"]["value"])" -eq "complete") { break }
        Start-Sleep -Milliseconds 30
      }
      $paperW = ($WidthMm / 25.4).ToString("0.########", [Globalization.CultureInfo]::InvariantCulture)
      $paperH = ($HeightMm / 25.4).ToString("0.########", [Globalization.CultureInfo]::InvariantCulture)
      $pdfParams = '{"landscape":false,"displayHeaderFooter":false,"printBackground":true,"scale":1,"paperWidth":' + $paperW + ',"paperHeight":' + $paperH + ',"marginTop":0,"marginBottom":0,"marginLeft":0,"marginRight":0,"preferCSSPageSize":false}'
      $pdf = Call-PrintCdp "Page.printToPDF" $pdfParams
      $data = ""
      if ($pdf) { $data = [string]$pdf["data"] }
      if (-not $data) { throw "pdf was not created" }
      [IO.File]::WriteAllBytes($PdfPath, [Convert]::FromBase64String($data))
      if ((Get-Item -LiteralPath $PdfPath).Length -lt 100) { throw "pdf was not created" }
      return
    } catch {
      Stop-PrintEdge
      if ($attempt -ge 2) { throw }
    }
  }
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

function Stop-ProfileEdge([string]$Profile) {
  for ($n = 0; $n -lt 5; $n++) {
    $procs = @(Get-ClinicEdge $Profile)
    if ($procs.Count -eq 0) { break }
    foreach ($proc in $procs) {
      try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Milliseconds 200
  }
  if (@(Get-ClinicEdge $Profile).Count -gt 0) { return }
  foreach ($name in @("SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile", "DevToolsActivePort")) {
    $path = Join-Path $Profile $name
    if (Test-Path -LiteralPath $path) {
      try { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Test-ClinicEdgeVisible([string]$Profile) {
  foreach ($proc in @(Get-ClinicEdge $Profile)) {
    try {
      $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -ne 0) { return $true }
    } catch {}
  }
  return $false
}

function Test-AnyClinicEdgeVisible {
  foreach ($name in @("edge-app", "edge-register", "edge-intake")) {
    if (Test-ClinicEdgeVisible (Join-Path $Root $name)) { return $true }
  }
  return $false
}

function Release-CardSession {
  if (-not (Get-Card6).running) { return }
  foreach ($path in @("/api/hc/v1/Logout", "/api/hpc/v1/Logout", "/api/common/v1/Finalize")) {
    try {
      $req = [System.Net.HttpWebRequest]::Create("https://127.0.0.1:5066" + $path)
      $req.Method = "POST"
      $req.Timeout = 1500
      $req.ContentType = "application/json"
      $req.Accept = "application/json"
      $req.ServerCertificateValidationCallback = { $true }
      $bytes = [Text.Encoding]::UTF8.GetBytes("{}")
      $req.ContentLength = $bytes.Length
      $stream = $req.GetRequestStream()
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Close()
      $resp = $req.GetResponse()
      $resp.Close()
    } catch {}
  }
}

function Watch-ClinicEdges {
  if (-not $script:ClinicEdgeSeen) { $script:ClinicEdgeSeen = @{} }
  if (-not $script:ClinicEdgeGone) { $script:ClinicEdgeGone = @{} }
  $closed = $false
  foreach ($name in @("edge-app", "edge-register", "edge-intake")) {
    $profile = Join-Path $Root $name
    $procs = @(Get-ClinicEdge $profile)
    if (Test-ClinicEdgeVisible $profile) {
      $script:ClinicEdgeSeen[$name] = $true
      $script:ClinicEdgeGone[$name] = 0
      continue
    }
    if (-not $script:ClinicEdgeSeen[$name]) { continue }
    if ($procs.Count -eq 0) {
      $script:ClinicEdgeGone[$name] = 0
      continue
    }
    $young = $false
    foreach ($proc in $procs) {
      try {
        $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime -gt (Get-Date).AddSeconds(-20)) { $young = $true }
      } catch {}
    }
    if ($young) { continue }
    $gone = 0
    try { $gone = [int]$script:ClinicEdgeGone[$name] } catch { $gone = 0 }
    $gone++
    $script:ClinicEdgeGone[$name] = $gone
    if ($gone -lt 2) { continue }
    Stop-ProfileEdge $profile
    $script:ClinicEdgeSeen[$name] = $false
    $script:ClinicEdgeGone[$name] = 0
    $closed = $true
    Write-Log ("closed " + $name)
  }
    if ($closed -and -not (Test-AnyClinicEdgeVisible)) {
      Stop-LocalCard6
      Get-Process -Name "csfsim" -ErrorAction SilentlyContinue | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
}

function Stop-LocalCard6 {
  Release-CardSession
  foreach ($name in @("ciet6001s01", "cies6001s04")) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Write-Log "closed card software 6.0"
}

function Stop-IdlePrintEdge {
  if (Test-AnyClinicEdgeVisible) { return }
  $profile = Join-Path $env:LOCALAPPDATA "PSEHR\print-edge"
  $alive = @(Get-ClinicEdge $profile).Count -gt 0
  if ($script:PrintEdge -and -not $script:PrintEdge.HasExited) { $alive = $true }
  if (-not $alive) { return }
  Stop-PrintEdge
  Stop-ProfileEdge $profile
  Write-Log "closed print-edge"
}

function Open-ClinicEdge {
  param([string]$Page = "", [string]$ProfileName = "edge-app")
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
    $profile = Join-Path $Root $ProfileName
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    if (Show-ClinicEdge $profile) { return }
    Stop-ProfileEdge $profile
    if (-not (Test-AnyClinicEdgeVisible)) { Release-CardSession }
    $edgeArgs = "--user-data-dir=`"$profile`" --app=`"$url`" --no-first-run --no-default-browser-check --disable-sync --disable-extensions --disable-background-mode --disable-component-extensions-with-background-pages --disable-features=LocalNetworkAccessChecks,msEdgeStartupBoost"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $edge
    $psi.Arguments = $edgeArgs
    $psi.UseShellExecute = $false
    [void][System.Diagnostics.Process]::Start($psi)
  } else { Start-Process $url }
}

function Get-ClinicEdge([string]$Profile) {
  $needle = "$Profile".ToLower()
  $found = @()
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $procs) {
      $cmd = "$($proc.CommandLine)".ToLower()
      if ($needle -and $cmd.Contains($needle)) { $found += $proc }
    }
  } catch {}
  return $found
}

function Show-DeskWindow([IntPtr]$Handle) {
  if (-not ([System.Management.Automation.PSTypeName]"PsehrWindow").Type) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PsehrWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
  }
  [void][PsehrWindow]::ShowWindow($Handle, 9)
  [void][PsehrWindow]::BringWindowToTop($Handle)
  [void][PsehrWindow]::SetForegroundWindow($Handle)
}

function Show-ClinicEdge([string]$Profile) {
  foreach ($proc in @(Get-ClinicEdge $Profile)) {
    try {
      $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
      if (-not $p -or $p.MainWindowHandle -eq 0) { continue }
      Show-DeskWindow $p.MainWindowHandle
      return $true
    } catch {}
  }
  return $false
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
  $width = 0.0
  $height = 0.0
  try { $width = [double]$job.widthMm } catch {}
  try { $height = [double]$job.heightMm } catch {}
  $turned = Convert-SlipForFeed $html $width $height "$($job.feed)"
  $htmlPath = Join-Path $dir "slip.html"
  $pdf = Join-Path $dir "slip.pdf"
  [IO.File]::WriteAllText($htmlPath, [string]$turned.Html, (New-Object System.Text.UTF8Encoding $false))
  Export-EdgePdf $edge $htmlPath $pdf ([double]$turned.Width) ([double]$turned.Height)
  $settings = Get-PrintSettings ([double]$turned.Width) ([double]$turned.Height) ([string]$turned.Feed)
  $quoted = '"' + ($printer -replace '"', '\"') + '"'
  $sp = New-Object System.Diagnostics.ProcessStartInfo
  $sp.FileName = $exe
  $sp.Arguments = "-silent -print-to $quoted -print-settings `"$settings`" -exit-when-done `"$pdf`""
  $sp.UseShellExecute = $false
  $sp.CreateNoWindow = $true
  $printed = [System.Diagnostics.Process]::Start($sp)
  if (-not $printed.WaitForExit(20000)) {
    try { Stop-Process -Id $printed.Id -Force -ErrorAction SilentlyContinue } catch {}
    throw "printer timed out"
  }
}

function Test-Port5066Excluded {
  foreach ($family in @("ipv4", "ipv6")) {
    $raw = netsh int $family show excludedportrange protocol=tcp | Out-String
    foreach ($line in ($raw -split "`r?`n")) {
      if ($line -match "^\s*(\d+)\s+(\d+)") {
        $start = [int]$Matches[1]
        $end = [int]$Matches[2]
        if (5066 -ge $start -and 5066 -le $end) { return $true }
      }
    }
  }
  return $false
}

function Start-LocalCard6 {
  $card = Get-Card6
  if (-not $card.installed) {
    Write-Log "card software 6.0 is not installed"
    return
  }
  if ($card.running) { return }
  $pf86 = ${env:ProgramFiles(x86)}
  if (-not $pf86) { $pf86 = "C:\Program Files (x86)" }
  $exe = Join-Path $pf86 "NHI\cshis6\ciet6001s01.exe"
  $alive = @(Get-Process -Name ciet6001s01 -ErrorAction SilentlyContinue)
  if ($alive.Count -eq 0) {
    try {
      Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null
      Write-Log "started card software 6.0"
    } catch {
      Write-Log $_.Exception.Message
      return
    }
  }
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if ((Get-Card6).running) { return }
  }
  Write-Log "card software 6.0 did not listen"
}

function Request-Release5066 {
  $card = Get-Card6
  if (-not $card.installed -or $card.running) { return }
  if (-not (Test-Port5066Excluded)) { return }
  $ps1 = Join-Path $Here "release_port_5066.ps1"
  if (-not (Test-Path -LiteralPath $ps1)) { return }
  $stamp = Join-Path $Root "port5066-ask.txt"
  if ((Test-Path -LiteralPath $stamp) -and ((Get-Date) - (Get-Item -LiteralPath $stamp).LastWriteTime).TotalSeconds -lt 90) { return }
  Set-Content -Path $stamp -Value (Get-Date -Format o) -Encoding ASCII
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  try {
    Start-Process -FilePath $ps -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`""
  } catch {
    Write-Log $_.Exception.Message
  }
}

function Start-LocalPrinterListener {
  $tcp = $null
  for ($try = 0; $try -lt 10; $try++) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, 5310)
      $tcp.Start()
      break
    } catch {
      $tcp = $null
      Start-Sleep -Milliseconds 300
    }
  }
  if (-not $tcp) {
    Write-Log "printer list already listening"
    return
  }
  $ps = [PowerShell]::Create()
  [void]$ps.AddScript({
    param($tcp, $clientDir)
    function Send-Bytes($client, [byte[]]$Bytes) {
      $stream = $client.GetStream()
      $stream.Write($Bytes, 0, $Bytes.Length)
      $stream.Flush()
    }
    if (-not ([System.Management.Automation.PSTypeName]"PsehrTrustAll").Type) {
      Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class PsehrTrustAll : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object PsehrTrustAll
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    function Send-Json($client, [string]$Json, [int]$Status) {
      $cors = "Access-Control-Allow-Origin: *`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: *`r`n"
      $reason = "OK"
      if ($Status -eq 204) { $reason = "No Content" }
      if ($Status -eq 400) { $reason = "Bad Request" }
      if ($Status -eq 404) { $reason = "Not Found" }
      $payload = [Text.Encoding]::UTF8.GetBytes($Json)
      $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $Status $reason`r`n" + $cors + "Content-Type: application/json; charset=utf-8`r`nContent-Length: " + $payload.Length + "`r`nConnection: close`r`n`r`n")
      $stream = $client.GetStream()
      $stream.Write($head, 0, $head.Length)
      if ($payload.Length -gt 0) { $stream.Write($payload, 0, $payload.Length) }
      $stream.Flush()
    }
    function Test-CardPort {
      $client = New-Object System.Net.Sockets.TcpClient
      try {
        $wait = $client.BeginConnect("127.0.0.1", 5066, $null, $null)
        $ok = $wait.AsyncWaitHandle.WaitOne(400, $false) -and $client.Connected
        return $ok
      } catch { return $false } finally { $client.Close() }
    }
    function Get-CardExe {
      $pf86 = ${env:ProgramFiles(x86)}
      if (-not $pf86) { $pf86 = "C:\Program Files (x86)" }
      return (Join-Path $pf86 "NHI\cshis6\ciet6001s01.exe")
    }
    function Get-PrinterJson {
      $bits = New-Object System.Collections.Generic.List[string]
      try {
        $items = @(Get-CimInstance -ClassName Win32_Printer -ErrorAction SilentlyContinue)
        foreach ($item in $items) {
          $name = "$($item.Name)".Trim()
          if (-not $name) { continue }
          $safe = $name.Replace("\", "\\").Replace('"', '\"')
          $flag = "false"
          if ($item.Default) { $flag = "true" }
          [void]$bits.Add('{"name":"' + $safe + '","default":' + $flag + '}')
        }
      } catch {}
      return ($bits -join ",")
    }
    function Invoke-CoexistProbe {
      $card6 = Test-CardPort
      $samStatus = -1
      $hpcStatus = -1
      $readerCount = 0
      if ($card6) {
        try {
          $st = Invoke-CshisProxy "GET" "/api/common/v1/Status" "" | ConvertFrom-Json
          if ($null -ne $st.status.sam.status) { $samStatus = [int]$st.status.sam.status }
          if ($null -ne $st.status.hpc.status) { $hpcStatus = [int]$st.status.hpc.status }
        } catch {}
        try {
          $rd = Invoke-CshisProxy "GET" "/api/settings/v1/PcscReader/Readers" "" | ConvertFrom-Json
          $list = @($rd.readers)
          if ($list.Count -eq 0) { $list = @($rd.Readers) }
          $readerCount = @($list | Where-Object { "$_".Trim() }).Count
        } catch {}
      }
      $five = @(Get-Process -Name "csfsim" -ErrorAction SilentlyContinue)
      $fiveRunning = $five.Count -gt 0
      $fiveBlocked = $false
      if ($fiveRunning) {
        $ps32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
        $pid5 = [int]$five[0].Id
        $mod = & $ps32 -NoProfile -Command "(Get-Process -Id $pid5).Modules | Where-Object { `$_.ModuleName -eq 'WinSCard.dll' } | Select-Object -ExpandProperty FileName"
        if ("$mod".Trim().ToLower() -eq "c:\nhi\bin\winscard.dll") { $fiveBlocked = $true }
      }
      $samFile = @(Get-ChildItem "C:\NHI\SAM\COMX1" -File -ErrorAction SilentlyContinue).Count -gt 0
      $cloudCode = -1
      $dll = "Z:\SC\DLL\nhi_eiiapi.dll"
      if ($samFile -and (Test-Path -LiteralPath $dll)) {
        $ps32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
        $work = "C:\Temp\psehr-qlab"
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        $call = Join-Path $work "call-testb.ps1"
        $dir = Split-Path -Parent $dll
        $body = @(
          "`$ErrorActionPreference = 'Stop'",
          "Set-Location '$dir'",
          "`$env:PATH = '$dir;' + `$env:PATH",
          "Add-Type -TypeDefinition @'",
          "using System.Runtime.InteropServices;",
          "using System.Text;",
          "public class CloudTest {",
          "  [DllImport(@`"$dll`", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]",
          "  public static extern int NHI_TestB(StringBuilder localId);",
          "}",
          "'@",
          "`$local = New-Object System.Text.StringBuilder 64",
          "`$code = [CloudTest]::NHI_TestB(`$local)",
          "Write-Output ('code=' + `$code)"
        ) -join "`r`n"
        [IO.File]::WriteAllText($call, $body, (New-Object System.Text.UTF8Encoding $false))
        $text = & $ps32 -NoProfile -ExecutionPolicy Bypass -File $call
        foreach ($row in @($text)) {
          $trim = "$row".Trim()
          if ($trim.StartsWith("code=")) {
            $parsed = 0
            if ([int]::TryParse($trim.Substring(5).Trim(), [ref]$parsed)) { $cloudCode = $parsed }
          }
        }
      }
      $c6 = "false"; if ($card6) { $c6 = "true" }
      $fr = "false"; if ($fiveRunning) { $fr = "true" }
      $fb = "false"; if ($fiveBlocked) { $fb = "true" }
      $sf = "false"; if ($samFile) { $sf = "true" }
      return '{"ok":true,"card6":' + $c6 + ',"samStatus":' + $samStatus + ',"hpcStatus":' + $hpcStatus + ',"readerCount":' + $readerCount + ',"fiveRunning":' + $fr + ',"fiveBlocked":' + $fb + ',"samFile":' + $sf + ',"cloudCode":' + $cloudCode + '}'
    }
    function Invoke-CshisProxy([string]$Method, [string]$Path, [string]$JsonBody) {
      $allowed = @(
        "/api/settings/v1/PcscReader/Readers",
        "/api/settings/v1/PcscReader/Default",
        "/api/settings/v1/PcscReader/AutoDetected",
        "/api/settings/v1/CloudSam",
        "/api/common/v1/Status",
        "/api/common/v1/Finalize",
        "/api/common/v1/Initial",
        "/api/sam/v1/Verification",
        "/api/sam/v1/Basic",
        "/api/sam/v1/Signature",
        "/api/hc/v1/Basic",
        "/api/hc/v1/Logout",
        "/api/hc/v1/Signature/Hc",
        "/api/hc/v1/Signature/HpcHc",
        "/api/hc/v1/Verification/VirtualHc",
        "/api/hpc/v1/Basic",
        "/api/hpc/v1/Logout",
        "/api/hpc/v1/Signature",
        "/api/hpc/v1/Verification/Hpc"
      )
      if ($Method -ne "GET" -and $Method -ne "POST" -and $Method -ne "DELETE") { return '{"ok":false,"statusCode":400}' }
      if ($allowed -notcontains $Path) { return '{"ok":false,"statusCode":400}' }
      try {
        $req = [System.Net.HttpWebRequest]::Create("https://127.0.0.1:5066" + $Path)
        $req.Method = $Method
        $req.Timeout = 20000
        $req.Accept = "application/json"
        $req.ServerCertificateValidationCallback = { $true }
        if ($Method -eq "POST") {
          $bytes = [Text.Encoding]::UTF8.GetBytes($(if ($JsonBody) { $JsonBody } else { "{}" }))
          $req.ContentType = "application/json"
          $req.ContentLength = $bytes.Length
          $out = $req.GetRequestStream()
          $out.Write($bytes, 0, $bytes.Length)
          $out.Close()
        } elseif ($Method -eq "DELETE") {
          $req.ContentLength = 0
        }
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        if (-not $text) { return "{}" }
        return $text
      } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) {
          $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
          $text = $reader.ReadToEnd()
          $reader.Close()
          if ($text) { return $text }
        }
        return '{"ok":false,"error":"unreachable","statusCode":1119}'
      } catch {
        return '{"ok":false,"error":"unreachable","statusCode":1119}'
      }
    }
    while ($true) {
      $client = $null
      try {
        $client = $tcp.AcceptTcpClient()
        $stream = $client.GetStream()
        $stream.ReadTimeout = 3000
        $bucket = New-Object System.IO.MemoryStream
        $chunk = New-Object byte[] 8192
        while ($true) {
          $n = 0
          try { $n = $stream.Read($chunk, 0, $chunk.Length) } catch { break }
          if ($n -le 0) { break }
          $bucket.Write($chunk, 0, $n)
          $soFar = [Text.Encoding]::UTF8.GetString($bucket.ToArray())
          $split = $soFar.IndexOf("`r`n`r`n")
          if ($split -lt 0) { if ($bucket.Length -gt 65536) { break }; continue }
          $need = 0
          foreach ($headerLine in ($soFar.Substring(0, $split) -split "`r`n")) {
            if ($headerLine -match "^Content-Length:\s*(\d+)") { $need = [int]$Matches[1] }
          }
          if (($bucket.Length - $split - 4) -ge $need) { break }
          if ($bucket.Length -gt 2000000) { break }
        }
        $text = [Text.Encoding]::UTF8.GetString($bucket.ToArray())
        $line = ($text -split "`r`n", 2)[0]
        $parts = $line -split " "
        $verb = $parts[0]
        $target = ""
        if ($parts.Length -gt 1) { $target = ($parts[1] -split "\?")[0] }
        if ($verb -eq "OPTIONS") {
          Send-Json $client "" 204
          continue
        }
        if ($verb -eq "GET" -and $target -eq "/health") {
          $exe = Get-CardExe
          $installed = Test-Path -LiteralPath $exe
          $running = $false
          if ($installed) { $running = Test-CardPort }
          $flag = "false"
          $run = "false"
          if ($installed) { $flag = "true" }
          if ($running) { $run = "true" }
          $printers = Get-PrinterJson
          Send-Json $client ('{"ok":true,"printers":[' + $printers + '],"card6":{"installed":' + $flag + ',"running":' + $run + "}}") 200
          continue
        }
        if ($verb -eq "POST" -and $target -eq "/tools/card-pair") {
          $action = "ensure"
          if ($line -match "action=(ensure|restart6|restart5)") { $action = $Matches[1] }
          if ($text -match '"action"\s*:\s*"(ensure|restart6|restart5)"') { $action = $Matches[1] }
          $pair = Join-Path $clientDir "card_pair.ps1"
          $raw = ""
          if (Test-Path -LiteralPath $pair) {
            $raw = (& $pair -Action $action | Out-String).Trim()
          }
          $json = ""
          foreach ($row in @($raw -split "`r?`n")) {
            $trim = "$row".Trim()
            if ($trim.StartsWith("{")) { $json = $trim }
          }
          if (-not $json) { $json = '{"ok":false,"action":"fail"}' }
          Send-Json $client $json 200
          continue
        }
        if ($verb -eq "POST" -and $target -eq "/tools/card") {
          $exe = Get-CardExe
          if (-not (Test-Path -LiteralPath $exe)) {
            Send-Json $client '{"ok":false,"code":"missing"}' 200
            continue
          }
          if (Test-CardPort) {
            Send-Json $client '{"ok":true,"code":"running"}' 200
            continue
          }
          Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) | Out-Null
          Send-Json $client '{"ok":true,"code":"started"}' 200
          continue
        }
        if ($verb -eq "POST" -and $target -eq "/tools/coexist-test") {
          $note = Invoke-CoexistProbe
          Send-Json $client $note 200
          continue
        }
        if ($verb -eq "POST" -and $target -eq "/tools/cshis") {
          $rawBody = ""
          $splitAt = $text.IndexOf("`r`n`r`n")
          if ($splitAt -ge 0) { $rawBody = $text.Substring($splitAt + 4) }
          $method = "GET"
          $path = ""
          $inner = ""
          try {
            $payload = $rawBody | ConvertFrom-Json
            if ($payload.method) { $method = "$($payload.method)".ToUpper() }
            if ($payload.path) { $path = "$($payload.path)" }
            if ($payload.body) { $inner = ($payload.body | ConvertTo-Json -Compress -Depth 6) }
          } catch {}
          $proxied = Invoke-CshisProxy $method $path $inner
          Send-Json $client $proxied 200
          continue
        }
        if ($verb -eq "GET" -and ($target -eq "/printers" -or $target -eq "/")) {
          Send-Json $client ('{"ok":true,"printers":[' + (Get-PrinterJson) + "]}") 200
          continue
        }
        if ($verb -eq "POST" -and $target -eq "/print") {
          $rawBody = ""
          $splitAt = $text.IndexOf("`r`n`r`n")
          if ($splitAt -ge 0) { $rawBody = $text.Substring($splitAt + 4) }
          if (-not $rawBody.Trim()) {
            Send-Json $client '{"ok":false,"detail":"empty print"}' 400
            continue
          }
          $box = Join-Path $env:LOCALAPPDATA "PSEHR\print-box"
          New-Item -ItemType Directory -Force -Path $box | Out-Null
          $id = [guid]::NewGuid().ToString("n")
          $req = Join-Path $box ($id + ".req")
          [IO.File]::WriteAllText($req, $rawBody, (New-Object System.Text.UTF8Encoding $false))
          $printer = ""
          try {
            $payload = $rawBody | ConvertFrom-Json
            if ($payload.printerName) { $printer = "$($payload.printerName)" }
          } catch {}
          $note = @{ ok = $true; queued = $true; printer = $printer } | ConvertTo-Json -Compress
          Send-Json $client $note 200
          continue
        }
        Send-Json $client '{"detail":"not found"}' 404
      } catch {
      } finally {
        if ($client) { $client.Close() }
      }
    }
  }).AddArgument($tcp).AddArgument($Here)
  [void]$ps.BeginInvoke()
  Write-Log "printer list on 5310"
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
    Start-LocalPrinterListener
    Request-Release5066
    $nextSide = [datetime]::MinValue
    while ($true) {
      try {
        $box = Join-Path $Root "print-box"
        if (Test-Path -LiteralPath $box) {
          foreach ($reqFile in @(Get-ChildItem -LiteralPath $box -Filter "*.req" -ErrorAction SilentlyContinue)) {
            $resFile = Join-Path $box ($reqFile.BaseName + ".res")
            try {
              $job = [IO.File]::ReadAllText($reqFile.FullName) | ConvertFrom-Json
              Invoke-OnePrint $job
              $done = @{ ok = $true; printer = "$($job.printerName)" } | ConvertTo-Json -Compress
              [IO.File]::WriteAllText($resFile, $done, (New-Object System.Text.UTF8Encoding $false))
            } catch {
              $fail = @{ ok = $false; detail = $_.Exception.Message } | ConvertTo-Json -Compress
              [IO.File]::WriteAllText($resFile, $fail, (New-Object System.Text.UTF8Encoding $false))
              Write-Log $_.Exception.Message
            }
            Remove-Item -LiteralPath $reqFile.FullName, $resFile -ErrorAction SilentlyContinue
          }
        }
        if ((Get-Date) -ge $nextSide) {
          $nextSide = (Get-Date).AddSeconds(4)
          $ip = Find-ClinicHost
          if ($ip) {
            $health = Get-Health | ConvertTo-Json -Depth 6 -Compress
            Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/report" -f $ip) "POST" $health | Out-Null
            $pending = Invoke-RestMethod -Uri ("http://{0}:3010/api/clinic/desk/jobs" -f $ip) -TimeoutSec 8
            foreach ($job in @($pending.jobs)) {
              if (-not $job -or -not $job.id) { continue }
              try {
                if ("$($job.kind)" -eq "quality-lab") {
                  $done = @{ ok = $false; detail = "saved-on-host" } | ConvertTo-Json -Compress
                } else {
                  Invoke-OnePrint $job
                  $done = @{ ok = $true; printer = "$($job.printerName)" } | ConvertTo-Json -Compress
                }
                Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/jobs/{1}" -f $ip, $job.id) "POST" $done | Out-Null
              } catch {
                $fail = @{ ok = $false; detail = $_.Exception.Message } | ConvertTo-Json -Compress
                try { Invoke-DeskJson ("http://{0}:3010/api/clinic/desk/jobs/{1}" -f $ip, $job.id) "POST" $fail | Out-Null } catch {}
                Write-Log $_.Exception.Message
              }
            }
          }
          try { Watch-ClinicEdges } catch { Write-Log $_.Exception.Message }
          try { Stop-IdlePrintEdge } catch { Write-Log $_.Exception.Message }
        }
      } catch { Write-Log $_.Exception.Message }
      Start-Sleep -Milliseconds 250
    }
  } finally {
    $mutex.ReleaseMutex() | Out-Null
  }
}

function Stop-OldAgent {
  $ids = @()
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $procs) {
      if ([int]$proc.ProcessId -eq $PID) { continue }
      $cmd = "$($proc.CommandLine)"
      if ($cmd -like "*-Open*" -or $cmd -like "*-Install*" -or $cmd -like "*-Register*" -or $cmd -like "*-Intake*") { continue }
      if ($cmd -like "*desk_agent.ps1*" -or $cmd -like "*desk_helper.ps1*") {
        $ids += [int]$proc.ProcessId
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  foreach ($id in $ids) {
    try { Wait-Process -Id $id -Timeout 3 -ErrorAction SilentlyContinue } catch {}
  }
}

if ($Intake) {
  Open-ClinicEdge -Page "kiosk/intake" -ProfileName "edge-intake"
  exit 0
}

if ($Open -or $Install -or $Register) {
  Request-Release5066
  $pair = Join-Path $Here "card_pair.ps1"
  if (Test-Path -LiteralPath $pair) { & $pair -Action ensure | Out-Null }
  else { Start-LocalCard6 }
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  Start-Process -FilePath $ps -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`"" -WindowStyle Hidden
  if ($Register) { Open-ClinicEdge -Page "kiosk/register" -ProfileName "edge-register" }
  else { Open-ClinicEdge }
  exit 0
}

Start-DeskLoop
