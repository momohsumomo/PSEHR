# Local desk helper for a browser-only clinic PC. No project folder.
param([int]$Port = 5310)

$ErrorActionPreference = "Stop"
$Root = Join-Path $env:LOCALAPPDATA "PSEHR"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$Log = Join-Path $Root "desk.log"

function Write-Log([string]$Line) {
  try { Add-Content -Path $Log -Value ((Get-Date -Format "HH:mm:ss") + " " + $Line) -Encoding ASCII } catch {}
}

function Ensure-Startup {
  try {
    $startup = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startup "PSEHR-desk.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($lnk)
    $link.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $link.WindowStyle = 7
    $link.Save()
  } catch {}
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
      $dir = "$($key.GetValue('Path'))"
      if ($dir) { Add-SumatraPath (Join-Path $dir.TrimEnd('\') "SumatraPDF.exe") }
    } catch {}
  }
  foreach ($root in @(
      "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )) {
    try {
      Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object {
        "$($_.DisplayName)" -like "SumatraPDF*"
      } | ForEach-Object {
        if ($_.InstallLocation) { Add-SumatraPath (Join-Path "$($_.InstallLocation)".TrimEnd('\') "SumatraPDF.exe") }
        $icon = "$($_.DisplayIcon)".Split(",")[0].Trim().Trim('"')
        if ($icon -like "*.exe") { Add-SumatraPath $icon }
      }
    } catch {}
  }
  foreach ($lnk in @(
      (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SumatraPDF.lnk"),
      (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SumatraPDF\SumatraPDF.lnk"),
      (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\SumatraPDF.lnk"),
      (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\SumatraPDF\SumatraPDF.lnk")
    )) {
    if (-not (Test-Path -LiteralPath $lnk)) { continue }
    try {
      $shell = New-Object -ComObject WScript.Shell
      Add-SumatraPath "$($shell.CreateShortcut($lnk).TargetPath)"
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


function Missing-SumatraText {
  $codes = 0x9019,0x53f0,0x9084,0x6c92,0x6709,0x20,0x53,0x75,0x6d,0x61,0x74,0x72,0x61,0x50,0x44,0x46,0x3002,0x8acb,0x81ea,0x884c,0x4e0b,0x8f09,0x5b89,0x88dd,0xff0c,0x88dd,0x597d,0x5f8c,0x91cd,0x65b0,0x6574,0x7406,0x9019,0x6247,0x8996,0x7a97,0x3002
  $text = -join ($codes | ForEach-Object { [char]$_ })
  return $text + " https://www.sumatrapdfreader.org/download-free-pdf-viewer"
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
  return @{ installed = [bool]$installed; running = [bool]$running; legacy5 = [bool]$legacy; exe = $exe }
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
  try {
    $items = @(Get-CimInstance -ClassName Win32_Printer)
  } catch { return @() }
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
  $sumatra = Find-Sumatra
  $card = Get-Card6
  $card.Remove("exe")
  return @{
    ok = $true
    edge = [bool](Find-Edge)
    sumatra = [bool]$sumatra
    printers = @(Get-PrinterRows)
    card6 = $card
    vpn = (Test-Vpn)
  }
}

function Start-Card6 {
  $info = Get-Card6
  if (-not $info.installed) {
    $code = "missing"
    if ($info.legacy5) { $code = "legacy5" }
    return @{ ok = $false; code = $code; installed = $false; running = $false; legacy5 = [bool]$info.legacy5 }
  }
  if ($info.running) {
    return @{ ok = $true; code = "running"; installed = $true; running = $true; legacy5 = $false }
  }
  Start-Process -FilePath $info.exe | Out-Null
  return @{ ok = $true; code = "started"; installed = $true; running = $false; legacy5 = $false }
}

function ConvertTo-DeskJson($payload) {
  if ($payload.printers) {
    $items = @($payload.printers)
    $bits = @()
    foreach ($item in $items) {
      if ($item -is [string]) { $bits += ($item | ConvertTo-Json -Compress) }
      else { $bits += ($item | ConvertTo-Json -Compress -Depth 4) }
    }
    $payload = $payload.Clone()
    $payload.Remove("printers")
    $head = $payload | ConvertTo-Json -Compress -Depth 6
    if ($head -eq "{}") { return "{`"printers`":[" + ($bits -join ",") + "]}" }
    return $head.TrimEnd("}") + ",`"printers`":[" + ($bits -join ",") + "]}"
  }
  return ($payload | ConvertTo-Json -Compress -Depth 6)
}

function Send-Http($stream, [int]$Status, [string]$Body) {
  $text = if ($null -eq $Body) { "" } else { $Body }
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $reason = "OK"
  if ($Status -eq 204) { $reason = "No Content" }
  if ($Status -eq 400) { $reason = "Bad Request" }
  $head = "HTTP/1.1 $Status $reason`r`n" +
    "Access-Control-Allow-Origin: *`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
    "Access-Control-Allow-Headers: *`r`n" +
    "Content-Type: application/json; charset=utf-8`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    "Connection: close`r`n`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $raw = New-Object byte[] ($headBytes.Length + $bytes.Length)
  [Buffer]::BlockCopy($headBytes, 0, $raw, 0, $headBytes.Length)
  [Buffer]::BlockCopy($bytes, 0, $raw, $headBytes.Length, $bytes.Length)
  $stream.Write($raw, 0, $raw.Length)
}

function Read-Http($stream) {
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 8192
  $stream.ReadTimeout = 8000
  while ($ms.Length -lt 2000000) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
    $ascii = [Text.Encoding]::ASCII.GetString($ms.ToArray())
    $mark = $ascii.IndexOf("`r`n`r`n")
    if ($mark -lt 0) { continue }
    $header = $ascii.Substring(0, $mark)
    $need = 0
    foreach ($line in ($header -split "`r`n")) {
      if ($line -match "^Content-Length:\s*(\d+)") { $need = [int]$Matches[1] }
    }
    $have = $ms.Length - ($mark + 4)
    if ($have -ge $need) { break }
  }
  $all = $ms.ToArray()
  $asciiAll = [Text.Encoding]::ASCII.GetString($all)
  $mark2 = $asciiAll.IndexOf("`r`n`r`n")
  if ($mark2 -lt 0) { return $null }
  $header = $asciiAll.Substring(0, $mark2)
  $lines = $header -split "`r`n"
  $parts = $lines[0].Split(" ")
  $target = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
  $path = ($target -split "\?")[0]
  $need = 0
  foreach ($line in $lines) {
    if ($line -match "^Content-Length:\s*(\d+)") { $need = [int]$Matches[1] }
  }
  $body = ""
  if ($need -gt 0) {
    $start = $mark2 + 4
    $slice = $all[$start..($start + $need - 1)]
    $body = [Text.Encoding]::UTF8.GetString($slice)
  }
  return @{ method = $parts[0]; path = $path; body = $body }
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
  $dests = @("255.255.255.255")
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike "127.*" -and $_.PrefixLength -ge 8 -and $_.PrefixLength -le 30 -and
    $_.InterfaceAlias -notmatch "vEthernet|WSL|Nord|VPN|Loopback|Hyper-V|Virtual"
  } | ForEach-Object {
    $parts = $_.IPAddress.Split(".") | ForEach-Object { [int64]$_ }
    $ipNum = ($parts[0] -shl 24) -bor ($parts[1] -shl 16) -bor ($parts[2] -shl 8) -bor $parts[3]
    $block = (([int64]1 -shl (32 - [int]$_.PrefixLength)) - 1)
    $bcast = $ipNum -bor $block
    $text = "$((($bcast -shr 24) -band 255)).$((($bcast -shr 16) -band 255)).$((($bcast -shr 8) -band 255)).$($bcast -band 255)"
    if ($dests -notcontains $text) { $dests += $text }
  }
  foreach ($dest in $dests) {
    try { [void]$udp.Send($payload, $payload.Length, $dest, 5301) } catch {}
  }
  $deadline = (Get-Date).AddSeconds(2)
  while ((Get-Date) -lt $deadline) {
    try {
      $remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
      $bytes = $udp.Receive([ref]$remote)
      $text = [Text.Encoding]::ASCII.GetString($bytes)
      if ($text -match "^PSEHR-HOST (\d+\.\d+\.\d+\.\d+)$" -and (Test-ClinicPage $Matches[1])) {
        Set-Content -Path $file -Value $Matches[1] -Encoding ASCII
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
  $ip = Find-ClinicHost
  if (-not $ip) {
    Add-Type -AssemblyName System.Windows.Forms
    $codes = 0x627e,0x4e0d,0x5230,0x6b63,0x5728,0x958b,0x670d,0x52d9,0x7684,0x4e3b,0x6a5f,0x3002,0x8acb,0x78ba,0x8a8d,0x4e3b,0x6a5f,0x5df2,0x555f,0x52d5,0xff0c,0x800c,0x4e14,0x8ddf,0x9019,0x53f0,0x5728,0x540c,0x4e00,0x500b,0x7db2,0x6bb5,0x3002
    $msg = -join ($codes | ForEach-Object { [char]$_ })
    [System.Windows.Forms.MessageBox]::Show($msg, "PSEHR") | Out-Null
    return
  }
  $url = "http://{0}:3010/" -f $ip
  $edge = Find-Edge
  if ($edge) {
    $profile = Join-Path $Root "edge-app"
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $edgeArgs = "--user-data-dir=`"$profile`" --app=`"$url`" --no-first-run --no-default-browser-check --disable-sync --disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"
    Start-Process -FilePath $edge -ArgumentList $edgeArgs
  } else { Start-Process $url }
}

function Register-DeskWake {
  try {
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    New-Item -Path "HKCU:\Software\Classes\psehr-desk\shell\open\command" -Force | Out-Null
    Set-Item -Path "HKCU:\Software\Classes\psehr-desk" -Value "URL:PSEHR desk"
    New-ItemProperty -Path "HKCU:\Software\Classes\psehr-desk" -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
    Set-Item -Path "HKCU:\Software\Classes\psehr-desk\shell\open\command" -Value $cmd
  } catch {}
}

function Stop-OtherDeskHelper {
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $procs) {
      if ([int]$proc.ProcessId -eq $PID) { continue }
      if ("$($proc.CommandLine)" -like "*desk_helper.ps1*") {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Test-PortFree {
  $probe = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $probe.BeginConnect("127.0.0.1", $Port, $null, $null)
    $up = $iar.AsyncWaitHandle.WaitOne(200, $false) -and $probe.Connected
    return -not $up
  } catch {
    return $true
  } finally {
    try { $probe.Close() } catch {}
  }
}

Stop-OtherDeskHelper
$free = $false
for ($n = 0; $n -lt 15; $n++) {
  if (Test-PortFree) { $free = $true; break }
  Start-Sleep -Milliseconds 200
}
if (-not $free) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $codes = 0x9019,0x53f0,0x6ac3,0x53f0,0x7684,0x8b80,0x5361,0x5c0f,0x7a0b,0x5f0f,0x9084,0x4f54,0x8457,0xff0c,0x8acb,0x95dc,0x6389,0x770b,0x8a3a,0x8996,0x7a97,0x5f8c,0x518d,0x96d9,0x64ca,0x4e00,0x6b21,0x9023,0x5230,0x4e3b,0x6a5f,0x002e,0x0062,0x0061,0x0074,0x3002
    $msg = -join ($codes | ForEach-Object { [char]$_ })
    [System.Windows.Forms.MessageBox]::Show($msg, "PSEHR") | Out-Null
  } catch {}
  exit 1
}

$script:PrintJobs = New-Object System.Collections.Generic.List[object]

function Start-QueuedPrint([string]$Edge, [string]$Exe, [string]$HtmlPath, [string]$Pdf, [string]$Printer, [string]$Settings, [double]$Width, [double]$Height) {
  $fn = ${function:Export-EdgePdf}.ToString()
  $log = $Log
  $ps = [powershell]::Create()
  [void]$ps.AddScript({
    param($Edge, $Exe, $HtmlPath, $Pdf, $Printer, $Settings, $Width, $Height, $FnText, $LogPath)
    try {
      Set-Item -Path function:Export-EdgePdf -Value ([scriptblock]::Create($FnText))
      Export-EdgePdf $Edge $HtmlPath $Pdf ([double]$Width) ([double]$Height)
      & $Exe -silent -print-to $Printer -print-settings $Settings -exit-when-done $Pdf | Out-Null
    } catch {
      try { Add-Content -Path $LogPath -Value ((Get-Date -Format "HH:mm:ss") + " " + $_.Exception.Message) -Encoding ASCII } catch {}
    }
  }).AddArgument($Edge).AddArgument($Exe).AddArgument($HtmlPath).AddArgument($Pdf).AddArgument($Printer).AddArgument($Settings).AddArgument($Width).AddArgument($Height).AddArgument($fn).AddArgument($log)
  $script:PrintJobs.Add($ps)
  [void]$ps.BeginInvoke()
}

$tcp = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $Port)
$tcp.Start()
Write-Log "listen $Port"
try {
  Register-DeskWake
  Ensure-Startup
  Open-ClinicEdge
} catch {
  Write-Log $_.Exception.Message
}
try { if (Find-Edge) { Ensure-PrintEdge (Find-Edge) } } catch { Write-Log $_.Exception.Message }

while ($true) {
  $client = $null
  try {
    $client = $tcp.AcceptTcpClient()
    $stream = $client.GetStream()
    $req = Read-Http $stream
    if (-not $req) { continue }
    if ($req.method -eq "OPTIONS") { Send-Http $stream 204 ""; continue }
    $payload = $null
    if ($req.path -eq "/health" -or $req.path -eq "/printers") {
      $payload = Get-Health
      if ($req.path -eq "/printers") { $payload = @{ ok = $true; printers = @($payload.printers | ForEach-Object { $_.name }) } }
    } elseif ($req.path -eq "/tools/sumatra" -and $req.method -eq "POST") {
      $found = Find-Sumatra
      if ($found) { $payload = @{ ok = $true; code = "ready"; path = $found } }
      else { $payload = @{ ok = $false; code = "manual"; detail = (Missing-SumatraText) } }
    } elseif ($req.path -eq "/tools/card" -and $req.method -eq "POST") {
      $payload = Start-Card6
    } elseif ($req.path -eq "/print" -and $req.method -eq "POST") {
      $payload = @{ ok = $false; detail = "print is handled when the page calls this helper" }
      try {
        $job = $req.body | ConvertFrom-Json
        $printer = "$($job.printerName)".Trim()
        $html = "$($job.html)"
        if (-not $printer -or -not $html.Trim()) { throw "missing printer or html" }
        $names = @(Get-PrinterRows | ForEach-Object { $_.name })
        if ($names -notcontains $printer) { throw "printer not on this PC" }
        $exe = Find-Sumatra
        if (-not $exe) { throw (Missing-SumatraText) }
        $edge = Find-Edge
        if (-not $edge) { throw "no Edge" }
        $dir = Join-Path $env:TEMP ("psehr-" + [guid]::NewGuid().ToString("n"))
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $htmlPath = Join-Path $dir "slip.html"
        $pdf = Join-Path $dir "slip.pdf"
        $width = 0.0
        $height = 0.0
        try { $width = [double]$job.widthMm } catch {}
        try { $height = [double]$job.heightMm } catch {}
        $turned = Convert-SlipForFeed $html $width $height "$($job.feed)"
        [IO.File]::WriteAllText($htmlPath, [string]$turned.Html, (New-Object System.Text.UTF8Encoding $false))
        $settings = Get-PrintSettings ([double]$turned.Width) ([double]$turned.Height) ([string]$turned.Feed)
        Export-EdgePdf $edge $htmlPath $pdf ([double]$turned.Width) ([double]$turned.Height)
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
        $payload = @{ ok = $true; printer = $printer }
      } catch {
        $payload = @{ ok = $false; detail = $_.Exception.Message }
      }
    } else {
      Send-Http $stream 400 '{"detail":"not found"}'
      continue
    }
    $json = ConvertTo-DeskJson $payload
    $status = 200
    if ($payload.ok -eq $false -and $req.path -eq "/print") { $status = 400 }
    Send-Http $stream $status $json
  } catch {
    Write-Log $_.Exception.Message
  } finally {
    if ($client) { $client.Close() }
  }
}
