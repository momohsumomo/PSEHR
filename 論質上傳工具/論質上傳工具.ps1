# Lab-result upload on a PC that does not run card software 6.0.
# The visit PC only stores the report. This tool reads that list and calls NHI_SendB.
# Open reader software 5.1.7 on this PC first so the cloud SAM is available.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Here = Split-Path -Parent $PSCommandPath
$ConfigPath = Join-Path $Here "settings.json"

function U([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }

function Read-Config {
  $cfg = @{ host = "http://OPD:5000"; port = 0 }
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $saved = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($saved.host) { $cfg.host = [string]$saved.host }
      if ($null -ne $saved.port) { $cfg.port = [int]$saved.port }
    } catch {}
  }
  return $cfg
}

function Save-Config([string]$HostUrl, [int]$Port) {
  $json = @{ host = $HostUrl.Trim().TrimEnd("/"); port = $Port } | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($ConfigPath, $json, $utf8)
}

function Test-SixRunning {
  $up = $false
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect("127.0.0.1", 5066, $null, $null)
    $up = $wait.AsyncWaitHandle.WaitOne(400, $false) -and $client.Connected
  } catch {} finally { $client.Close() }
  return $up
}

function Test-FiveRunning {
  foreach ($proc in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $path = "$($proc.ExecutablePath)"
    $name = "$($proc.Name)"
    if ($path -match '\\cshis6\\') { continue }
    if ($path -match '\\NHI\\(cshis|CsHis)\\') { return $true }
    if ($name -match '^(CsHis|ciet5)') { return $true }
  }
  return $false
}

function Find-ReaderDll {
  foreach ($path in @(
    "C:\Reader.dll",
    (Join-Path $env:SystemRoot "SysWOW64\Reader.dll"),
    (Join-Path $env:SystemRoot "System32\Reader.dll"),
    "Z:\SC\reader_A.dll",
    "Z:\SC\reader_B.dll",
    "Z:\SC\reader_C.dll",
    "Z:\SC\reader_D.dll"
  )) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    $bytes = [IO.File]::ReadAllBytes($path)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    if ($text.Contains("OpenComPort")) { return $path }
  }
  return ""
}

function Find-UploadDll {
  $candidates = @()
  $override = [Environment]::GetEnvironmentVariable("NHI_EIIAPI_DLL")
  if ($override) { $candidates += $override }
  foreach ($dir in @("Z:\SC\DLL", "Z:\SC", "C:\NHI", $Here)) {
    $candidates += (Join-Path $dir "cnhi_eiiapi.dll")
    $candidates += (Join-Path $dir "nhi_eiiapi.dll")
  }
  foreach ($path in $candidates) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    $bytes = [IO.File]::ReadAllBytes($path)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    $kind = "legacy"
    if ($text.Contains("C:\NHI\SAM\COMX")) { $kind = "cloud" }
    return @{ path = $path; kind = $kind }
  }
  return $null
}

function Find-SamFile([int]$Port) {
  $dir = "C:\NHI\SAM\COMX$($Port + 1)"
  if (-not (Test-Path -LiteralPath $dir)) { return "" }
  $files = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { return "" }
  return [string]$files[0].FullName
}

function Test-Idc {
  foreach ($pair in @(@("10.253.253.250", 12500), @("10.253.253.241", 12300))) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $wait = $client.BeginConnect([string]$pair[0], [int]$pair[1], $null, $null)
      if ($wait.AsyncWaitHandle.WaitOne(800, $false) -and $client.Connected) { return $true }
    } catch {} finally { $client.Close() }
  }
  return $false
}

function Explain-UploadCode([int]$Code) {
  $auth = @(5010, 9010, 9012, 9013, 9014, 9015, 9020, 9050, 9051, 9060, 9061, 9062)
  $net = @(5000, 5028, 8203, 8218, 9003)
  if ($auth -contains $Code) {
    return (U @(35469,35657,37679,35492,12290,35531,30906,35469,32,53,46,49,46,55,32,24050,38283,21855,65292,19988,32,83,65,77,32,25918,22312,32,67,58,92,78,72,73,92,83,65,77,92,67,79,77,88,49,12290,40)) + $Code + (U @(41))
  }
  if ($net -contains $Code) {
    return (U @(36899,19981,21040,20581,20445,32626,12290,35531,20808,25509,19978,37291,30274,32178,12290,40)) + $Code + (U @(41))
  }
  return (U @(19978,20659,31243,24335,22238,32)) + $Code + (U @(12290,27284,26696,27794,26377,20132,20986,21435,12290))
}

function Invoke-Json([string]$Base, [string]$Path, [string]$Method, $Body) {
  $req = [System.Net.HttpWebRequest]::Create(($Base.TrimEnd("/") + $Path))
  $req.Method = $Method
  $req.Timeout = 20000
  $req.ReadWriteTimeout = 20000
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Compress -Depth 6
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentType = "application/json; charset=utf-8"
    $req.ContentLength = $bytes.Length
    $out = $req.GetRequestStream()
    $out.Write($bytes, 0, $bytes.Length)
    $out.Close()
  }
  $resp = $null
  try { $resp = $req.GetResponse() }
  catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
  }
  try {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
  } finally { $resp.Close() }
  $status = [int]$resp.StatusCode
  if ($status -ge 400) { throw $text }
  if (-not $text) { return $null }
  return $text | ConvertFrom-Json
}

function Invoke-SendB([string]$Dll, [string]$Reader, [string]$FilePath, [int]$Port) {
  $ps32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps32)) { throw (U @(25214,19981,21040,32,51,50,32,20301,20803,32,80,111,119,101,114,83,104,101,108,108)) }
  $work = "C:\Temp\psehr-qlab"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $script = Join-Path $work "call-send.ps1"
  $dllDir = Split-Path -Parent $Dll
  $safeDll = $Dll.Replace("'", "''")
  $safeDir = $dllDir.Replace("'", "''")
  $safeReader = $Reader.Replace("'", "''")
  $safeFile = $FilePath.Replace("'", "''")
  $body = @(
    "`$ErrorActionPreference = 'Stop'",
    "Set-Location '$safeDir'",
    "`$env:PATH = '$safeDir;' + `$env:PATH",
    "Add-Type -TypeDefinition @'",
    "using System.Runtime.InteropServices;",
    "using System.Text;",
    "public class LabUp {",
    "  [DllImport(@`"$safeDll`", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]",
    "  public static extern int NHI_SendB(int port, string reader, string file, string typeCode, StringBuilder localId, StringBuilder nhiId);",
    "}",
    "'@",
    "`$local = New-Object System.Text.StringBuilder 64",
    "`$nhi = New-Object System.Text.StringBuilder 64",
    "`$code = [LabUp]::NHI_SendB($Port, '$safeReader', '$safeFile', '26', `$local, `$nhi)",
    "Write-Output ('code=' + `$code)",
    "Write-Output ('local=' + `$local.ToString())",
    "Write-Output ('nhi=' + `$nhi.ToString())"
  ) -join "`r`n"
  [IO.File]::WriteAllText($script, $body, (New-Object System.Text.UTF8Encoding $false))
  $outFile = Join-Path $work "out.txt"
  $errFile = Join-Path $work "err.txt"
  if (Test-Path $outFile) { Remove-Item -LiteralPath $outFile -Force }
  if (Test-Path $errFile) { Remove-Item -LiteralPath $errFile -Force }
  $proc = Start-Process -FilePath $ps32 -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script) -PassThru -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  if (-not $proc.WaitForExit(70000)) {
    try { $proc.Kill() } catch {}
    throw (U @(19978,20659,31561,22826,20037,12290))
  }
  $text = ""
  if (Test-Path $outFile) { $text = [IO.File]::ReadAllText($outFile) }
  $code = $null
  $localId = ""
  $nhiId = ""
  foreach ($line in ($text -split "`n")) {
    $trim = $line.Trim()
    if ($trim.StartsWith("code=")) {
      $parsed = 0
      if ([int]::TryParse($trim.Substring(5).Trim(), [ref]$parsed)) { $code = $parsed }
    } elseif ($trim.StartsWith("local=")) { $localId = $trim.Substring(6).Trim() }
    elseif ($trim.StartsWith("nhi=")) { $nhiId = $trim.Substring(4).Trim() }
  }
  return @{ code = $code; localId = $localId; nhiId = $nhiId }
}

$cfg = Read-Config
$form = New-Object System.Windows.Forms.Form
$form.Text = U @(35542,36074,19978,20659,24037,20855,65288,19981,21487,22312,35712,21345,36575,39636,32,54,46,48,32,30340,38651,33126,19978,20351,29992,65289)
$form.Size = New-Object System.Drawing.Size(760, 520)
$form.StartPosition = "CenterScreen"
$form.Font = New-Object System.Drawing.Font("PMingLiU", 11)

$lblHost = New-Object System.Windows.Forms.Label
$lblHost.Text = U @(20027,27231)
$lblHost.Location = New-Object System.Drawing.Point(12, 14)
$lblHost.AutoSize = $true
$txtHost = New-Object System.Windows.Forms.TextBox
$txtHost.Text = $cfg.host
$txtHost.Location = New-Object System.Drawing.Point(52, 10)
$txtHost.Width = 280
$btnReload = New-Object System.Windows.Forms.Button
$btnReload.Text = U @(37325,26032,25972,29702)
$btnReload.Location = New-Object System.Drawing.Point(344, 8)
$btnReload.Width = 90
$btnSend = New-Object System.Windows.Forms.Button
$btnSend.Text = U @(19978,20659)
$btnSend.Location = New-Object System.Drawing.Point(442, 8)
$btnSend.Width = 70

$list = New-Object System.Windows.Forms.ListView
$list.View = "Details"
$list.FullRowSelect = $true
$list.GridLines = $true
$list.Location = New-Object System.Drawing.Point(12, 44)
$list.Size = New-Object System.Drawing.Size(720, 280)
[void]$list.Columns.Add((U @(30149,27511,34399)), 90)
[void]$list.Columns.Add((U @(22995,21517)), 90)
[void]$list.Columns.Add((U @(20581,20445,30908)), 90)
[void]$list.Columns.Add((U @(22577,21578)), 220)
[void]$list.Columns.Add((U @(29376,24907)), 80)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ScrollBars = "Vertical"
$log.ReadOnly = $true
$log.Location = New-Object System.Drawing.Point(12, 336)
$log.Size = New-Object System.Drawing.Size(720, 130)

function Add-Log([string]$Line) {
  $log.AppendText(((Get-Date).ToString("HH:mm:ss ") + $Line + "`r`n"))
}

function Reload-List {
  $list.Items.Clear()
  $base = $txtHost.Text.Trim().TrimEnd("/")
  $box = Invoke-Json $base "/nhi/v1/quality-lab/pending" "GET" $null
  foreach ($row in @($box.rows)) {
    $item = New-Object System.Windows.Forms.ListViewItem("$($row.medicalNo)")
    [void]$item.SubItems.Add("$($row.patientName)")
    [void]$item.SubItems.Add("$($row.orderCode)")
    $story = "$($row.report)"
    if ($story.Length -gt 24) { $story = $story.Substring(0, 24) }
    [void]$item.SubItems.Add($story)
    [void]$item.SubItems.Add((U @(26410,19978,20659)))
    $item.Tag = $row
    [void]$list.Items.Add($item)
  }
  Add-Log ((U @(24050,35712,21462,32)) + $list.Items.Count + (U @(32,31558,12290)))
}

$btnReload.Add_Click({
  try { Reload-List } catch { Add-Log $_.Exception.Message }
})

$btnSend.Add_Click({
  if ($list.SelectedItems.Count -lt 1) {
    Add-Log (U @(35531,20808,36984,19968,31558,12290))
    return
  }
  if (Test-SixRunning) {
    Add-Log (U @(36889,21488,27491,22312,36305,35712,21345,36575,39636,32,54,46,48,65292,19981,33021,19978,20659,12290))
    return
  }
  if (-not (Test-FiveRunning)) {
    Add-Log (U @(35531,20808,38283,21855,35712,21345,36575,39636,32,53,46,49,46,55,65292,21462,24471,26377,25928,23433,20840,27169,32068,24460,20877,19978,20659,12290))
    return
  }
  $port = 0
  $dll = Find-UploadDll
  if (-not $dll) {
    Add-Log (U @(25214,19981,21040,19978,20659,20803,20214,12290))
    return
  }
  $reader = ""
  if ($dll.kind -eq "cloud") {
    if (-not (Find-SamFile $port)) {
      Add-Log (U @(67,58,92,78,72,73,92,83,65,77,92,67,79,77,88,49,32,27794,26377,32,83,65,77,32,27284,12290))
      return
    }
  } else {
    $reader = Find-ReaderDll
    if (-not $reader) {
      Add-Log (U @(25214,19981,21040,32,82,101,97,100,101,114,46,100,108,108,12290))
      return
    }
  }
  if (-not (Test-Idc)) {
    Add-Log (U @(36899,19981,21040,20581,20445,32626,12290,35531,20808,25509,19978,37291,30274,32178,12290))
    return
  }
  $row = $list.SelectedItems[0].Tag
  $base = $txtHost.Text.Trim().TrimEnd("/")
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnSend.Enabled = $false
  try {
    Save-Config $base $port
    $packed = Invoke-Json $base "/nhi/v1/quality-lab/file" "POST" @{ id = "$($row.id)" }
    $dir = "C:\Temp\psehr-qlab"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir "$($packed.fileName)"
    [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String("$($packed.fileB64)"))
    $sent = Invoke-SendB $dll.path $reader $file $port
    if ($null -eq $sent.code) { throw (U @(19978,20659,31243,24335,27794,26377,22238,20195,30908,12290)) }
    if ([int]$sent.code -ne 0) { throw (Explain-UploadCode ([int]$sent.code)) }
    Invoke-Json $base "/nhi/v1/quality-lab/result" "POST" @{ id = "$($row.id)"; localId = "$($sent.localId)"; nhiId = "$($sent.nhiId)" } | Out-Null
    Add-Log (U @(24050,20132,20986,12290))
    Reload-List
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnSend.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

$form.Controls.AddRange(@($lblHost, $txtHost, $btnReload, $btnSend, $list, $log))
try { Reload-List } catch { Add-Log $_.Exception.Message }
[void]$form.ShowDialog()
