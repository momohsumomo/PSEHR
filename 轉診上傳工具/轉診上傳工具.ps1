# Referral upload on a PC that does not run card software 6.0.
# Reads slips from the clinic host and writes the bureau receipt back.
# The upload call is NHI_DownloadB. Authentication is inside that call:
# the DLL reads the SAM in C:\NHI\SAM\COMX{port+1} and mutually authenticates with IDC.
# There is no PIN on this screen. A reader DLL is only required for the old component.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Here = Split-Path -Parent $PSCommandPath
$ConfigPath = Join-Path $Here "settings.json"
$Title = -join (0x8f49,0x8a3a,0x4e0a,0x50b3,0x5de5,0x5177,0x28,0x4e0d,0x53ef,0x4f7f,0x7528,0x8b80,0x5361,0x8edf,0x9ad4,0x36,0x2e,0x30,0x7684,0x74b0,0x5883,0x29 | ForEach-Object { [char]$_ })

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
  } catch { $up = $false } finally { $client.Close() }
  if ($up) { return $true }
  $named = @(Get-Process -Name "ciet6001s01" -ErrorAction SilentlyContinue)
  return $named.Count -gt 0
}

function Find-ReaderDll {
  $override = [Environment]::GetEnvironmentVariable("NHI_EIIAPI_READER")
  $candidates = @()
  if ($override) { $candidates += $override }
  $candidates += @(
    "C:\Reader.dll",
    (Join-Path $env:SystemRoot "SysWOW64\Reader.dll"),
    (Join-Path $env:SystemRoot "System32\Reader.dll"),
    "Z:\SC\reader_A.dll",
    "Z:\SC\reader_B.dll",
    "Z:\SC\reader_C.dll",
    "Z:\SC\reader_D.dll"
  )
  foreach ($path in $candidates) {
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

function Get-SamSlot([int]$Port) {
  $n = $Port + 1
  if ($n -lt 1) { $n = 1 }
  return "C:\NHI\SAM\COMX$n"
}

function Find-SamFile([int]$Port) {
  $dir = Get-SamSlot $Port
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

function Get-AuthState([int]$Port) {
  $dll = Find-UploadDll
  $slot = Get-SamSlot $Port
  $sam = Find-SamFile $Port
  $reader = Find-ReaderDll
  $vpn = Test-Idc
  $lines = New-Object System.Collections.Generic.List[string]
  $ready = $true
  if (-not $dll) {
    $ready = $false
    $lines.Add((U @(25214,19981,21040,19978,20659,20803,20214,32,110,104,105,95,101,105,105,97,112,105,46,100,108,108,12290)))
  } elseif ($dll.kind -eq "cloud") {
    $lines.Add((U @(36889,25903,26159,38642,31471,23433,20840,27169,32068,35469,35657,12290,30059,38754,27794,26377,32,80,73,78,12290,19978,20659,26178,20803,20214,25343,32,83,65,77,32,36319,20581,20445,32626,32,73,68,67,32,20114,35469,65292,36890,36942,25165,31805,31456,21152,23494,36865,20986,12290)))
    $lines.Add("SAM $slot")
    if (-not $sam) {
      $ready = $false
      $lines.Add((U @(36889,20491,27133,27794,26377,32,83,65,77,32,27284,65292,27794,26377,36865,20986,12290,35531,25226,26377,25928,30340,32,83,65,77,32,25918,21040,36889,20491,36039,26009,22846,12290)))
    } else {
      $lines.Add((U @(83,65,77,32,27284,24050,30475,21040,12290)) + " " + $sam)
    }
  } else {
    $lines.Add((U @(36889,25903,33290,20803,20214,36996,35201,32,82,101,97,100,101,114,46,100,108,108,65292,35469,35657,19968,27171,22312,19978,20659,30070,19979,30001,23433,20840,27169,32068,23436,25104,12290)))
    if (-not $reader) {
      $ready = $false
      $lines.Add((U @(25214,19981,21040,32,82,101,97,100,101,114,46,100,108,108,12290,27794,26377,36865,20986,12290)))
    }
  }
  if (-not $vpn) {
    $ready = $false
    $lines.Add((U @(36899,19981,21040,20581,20445,32626,32,73,68,67,12290,35531,20808,25509,19978,37291,30274,32178,65292,35469,35657,25165,26371,36942,12290)))
  } else {
    $lines.Add((U @(73,68,67,32,36899,24471,21040,12290)))
  }
  if (Test-SixRunning) {
    $ready = $false
    $lines.Add((U @(36889,21488,27491,22312,36305,35712,21345,36575,39636,32,54,46,48,12290,36889,20491,24037,20855,19981,33021,22312,36889,21488,19978,20659,12290)))
  }
  return @{ ready = $ready; lines = $lines; dll = $dll; reader = $reader; sam = $sam }
}

function Explain-UploadCode([int]$Code) {
  $auth = @(5010, 9010, 9012, 9013, 9014, 9015, 9020, 9050, 9051, 9060, 9061, 9062)
  $net = @(5000, 5028, 8203, 8218, 9003)
  if ($auth -contains $Code) {
    return (U @(35469,35657,37679,35492,12290,83,65,77,32,36319,32,73,68,67,32,27794,26377,23565,19978,12290,35531,30906,35469,32,83,65,77,32,25918,22312,23565,25033,30340,27133,65292,32780,19988,37291,30274,32178,26159,36890,30340,12290,65288)) + $Code + (U @(65289))
  }
  if ($net -contains $Code) {
    return (U @(36899,19981,21040,20581,20445,32626,32,73,68,67,12290,35531,20808,25509,19978,37291,30274,32178,65292,35469,35657,25165,26371,36942,12290,65288)) + $Code + (U @(65289))
  }
  if ($Code -eq 5005) {
    return (U @(31805,31456,27794,26377,23436,25104,65288,53,48,48,53,65289,12290,35469,35657,24050,20570,65292,36889,20221,27284,27794,31805,36215,20358,12290))
  }
  return (U @(0x4e0a,0x50b3,0x51fd,0x5f0f,0x56de,0x20)) + $Code + (U @(0x3002,0x6a94,0x6848,0x6c92,0x6709,0x4ea4,0x51fa,0x53bb,0x3002))
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

function Get-Api([string]$Base, [string]$Path) {
  return Invoke-Json $Base $Path "GET" $null
}

function Post-Api([string]$Base, [string]$Path, $Body) {
  return Invoke-Json $Base $Path "POST" $Body
}

function Person-Id([string]$Text) {
  $value = "$Text".Trim().ToUpper()
  if ($value.Length -eq 10 -and $value.Substring(0, 1) -match "^[A-Z]$" -and $value.Substring(1) -match "^\d{9}$") { return $value }
  return ""
}

function Find-DoctorId($Slip, $Doctors) {
  $direct = Person-Id "$($Slip.doctor)"
  if ($direct) { return $direct }
  $name = "$($Slip.doctor)".Trim()
  foreach ($row in @($Doctors)) {
    if ("$($row.name)".Trim() -eq $name) {
      $hit = Person-Id "$($row.nhiId)"
      if ($hit) { return $hit }
    }
  }
  return ""
}

function Convert-Ymd([string]$Text) {
  $raw = "$Text".Trim()
  if ($raw -match "^\d{8}$") { return $raw }
  if ($raw -match "^(\d{4})-(\d{2})-(\d{2})") { return $Matches[1] + $Matches[2] + $Matches[3] }
  if ($raw -match "^(\d{1,3})[./](\d{1,2})[./](\d{1,2})$") {
    $year = [int]$Matches[1]
    if ($year -lt 1911) { $year += 1911 }
    return "{0:0000}{1:00}{2:00}" -f $year, [int]$Matches[2], [int]$Matches[3]
  }
  return (Get-Date).ToString("yyyyMMdd")
}

function Convert-Icd([string]$Text) {
  $token = ("$Text".Trim() -split "\s+")[0]
  if (-not $token) { return "" }
  $code = ($token.ToUpper() -replace "\.", "" -replace " ", "")
  if ($code.Length -gt 9) { $code = $code.Substring(0, 9) }
  if ($code.Length -lt 3) { return "" }
  if ($code.Substring(0, 1) -notmatch "^[A-Z]$") { return "" }
  if ($code.Substring(1, 1) -notmatch "^\d$") { return "" }
  return $code
}

function Xml-Text([string]$Value) {
  if (-not $Value) { return "" }
  return $Value.Replace("&", ([char]0xFF06)).Replace("<", ([char]0xFF1C)).Replace(">", ([char]0xFF1E)).Replace("'", ([char]0x2019)).Replace('"', ([char]0x201D))
}

function Get-Pairs($Value) {
  $items = @($Value)
  $list = New-Object System.Collections.Generic.List[object]
  if ($items.Count -eq 2 -and $items[0] -is [string]) {
    $list.Add(@([string]$items[0], [string]$items[1]))
  } else {
    foreach ($item in $items) {
      if ($item -is [System.Array] -and $item.Count -ge 2) { $list.Add($item) }
    }
  }
  Write-Output -NoEnumerate $list
}

function Dept-Code([string]$Text) {
  $raw = "$Text".Trim()
  if ($raw -match "^(\d{2})") { return $Matches[1] }
  if (-not $raw) { return "" }
  if ($raw.Length -ge 2) { return $raw.Substring(0, 2) }
  return $raw
}

function New-Xml([string]$Root, [string]$Hosp, [string]$Tel, [string]$BodyName, $Fields, $Header) {
  $lines = @('<?xml version="1.0" encoding="Big5"?>', "<$Root>", "  <hospid>$Hosp</hospid>")
  if ($Tel) { $lines += "  <hosptel>$(Xml-Text $Tel)</hosptel>" }
  foreach ($pair in (Get-Pairs $Header)) {
    if ($pair -and $pair[1]) { $lines += "  <$($pair[0])>$(Xml-Text $pair[1])</$($pair[0])>" }
  }
  $lines += "  <$BodyName>"
  foreach ($pair in (Get-Pairs $Fields)) {
    if ($pair -and "$($pair[1])") { $lines += "    <$($pair[0])>$(Xml-Text $pair[1])</$($pair[0])>" }
  }
  $lines += "  </$BodyName>"
  $lines += "</$Root>"
  return ($lines -join "`n")
}

function Build-OpenXml($Slip, [string]$Hosp, [string]$DoctorId, [string]$ClinicPhone, [string]$ClinicAddress, [string]$ClinicEmail) {
  $sex = "$($Slip.sex)".Trim()
  $sexCode = ""
  if ($sex -in @("1", "M", (U @(0x7537)))) { $sexCode = "1" }
  elseif ($sex -in @("2", "F", (U @(0x5973)))) { $sexCode = "2" }
  $purpose = "$($Slip.purpose)".Trim()
  if (-not $purpose) { $purpose = "4" }
  $purpose = $purpose.Substring(0, 1)
  $destRaw = "$($Slip.destDept)".Trim()
  $ourRaw = "$($Slip.ourDept)".Trim()
  if ($destRaw) {
    $destDept = Dept-Code $destRaw
    if (-not $destDept) { $destDept = "11" }
    $our = Dept-Code $ourRaw
    if (-not $our) { $our = Dept-Code "$($Slip.dept)" }
    if (-not $our) { $our = "11" }
  } else {
    $destDept = Dept-Code "$($Slip.dept)"
    if (-not $destDept) { $destDept = "11" }
    $our = Dept-Code $ourRaw
    if (-not $our) { $our = "11" }
  }
  $note = "$($Slip.purposeNote)"
  if ($purpose -ne "6") { $note = "" }
  return New-Xml "etahosp" $Hosp "" "etadata" @(
    @("h1", "$($Slip.idNo)".Trim().ToUpper()),
    @("h2", "$($Slip.patientName)".Trim()),
    @("h3", $sexCode),
    @("h4", $(if ($Slip.birth) { Convert-Ymd "$($Slip.birth)" } else { "" })),
    @("h5", "$($Slip.contact)"),
    @("h6", "$($Slip.phone)".Trim()),
    @("h7", "$($Slip.address)"),
    @("h8", "$($Slip.note)".Trim()),
    @("h9", (Convert-Icd "$($Slip.diagnosis)")),
    @("h13", "$($Slip.historyText)"),
    @("h15", "$($Slip.treatText)"),
    @("h17", "$($Slip.allergyText)"),
    @("h18", $purpose),
    @("h19", $note),
    @("h20", $DoctorId),
    @("h21", $our),
    @("h22", $ClinicPhone),
    @("h23", (Convert-Ymd "$($Slip.openedOn)")),
    @("h28", "$($Slip.destCode)".Trim()),
    @("h29", $destDept),
    @("h30", "$($Slip.destDoctor)"),
    @("h31", "$($Slip.destAddr)"),
    @("h32", "$($Slip.destTel)"),
    @("h34", (Convert-Ymd "$($Slip.validUntil)"))
  ) @(
    @("hospaddr", $ClinicAddress),
    @("hospemail", $ClinicEmail)
  )
}

function Build-ReplyXml($Slip, [string]$Hosp, [string]$DoctorId, [string]$ClinicPhone, [string]$ClinicEmail) {
  $purpose = "$($Slip.purpose)".Trim()
  if (-not $purpose) { $purpose = "4" }
  $purpose = $purpose.Substring(0, 1)
  $dept = Dept-Code "$($Slip.dept)"
  if (-not $dept) { $dept = "11" }
  $remark = ""
  if ($purpose -in @("2", "3", "4", "9")) { $remark = $dept }
  $none = U @(0x7121)
  $drugs = "$($Slip.drugs)".Trim()
  if (-not $drugs) { $drugs = $none }
  $aux = "$($Slip.aux)".Trim()
  if (-not $aux) { $aux = $none }
  $handoff = "$($Slip.handoff)".Trim()
  if (-not $handoff) { $handoff = "$($Slip.note)".Trim() }
  return New-Xml "etbhosp" $Hosp $ClinicPhone "etbdata" @(
    @("h1", "$($Slip.serial)".Trim()),
    @("h2", "$($Slip.idNo)".Trim().ToUpper()),
    @("h3", $DoctorId),
    @("h4", $dept),
    @("h5", $(if ("$($Slip.replyDay)".Trim()) { Convert-Ymd "$($Slip.replyDay)" } else { (Get-Date).ToString("yyyyMMdd") })),
    @("h6", $purpose),
    @("h7", $remark),
    @("h8", (Convert-Icd "$($Slip.diagnosis)")),
    @("h9", $drugs),
    @("h10", $aux),
    @("h11", $handoff)
  ) @(
    @("hospemail", $ClinicEmail)
  )
}

function Invoke-DownloadB([string]$Dll, [string]$Reader, [string]$FilePath, [string]$TypeCode, [int]$Port) {
  $ps32 = Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps32)) { throw (U @(0x627e,0x4e0d,0x5230,0x20,0x33,0x32,0x20,0x4f4d,0x5143,0x20,0x50,0x6f,0x77,0x65,0x72,0x53,0x68,0x65,0x6c,0x6c)) }
  $work = "C:\Temp\psehr-refup"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $script = Join-Path $work "call-download.ps1"
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
    "public class RefUp {",
    "  [DllImport(@`"$safeDll`", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]",
    "  public static extern int NHI_DownloadB(int port, string reader, string file, string typeCode, StringBuilder localId, StringBuilder nhiId);",
    "}",
    "'@",
    "`$local = New-Object System.Text.StringBuilder 64",
    "`$nhi = New-Object System.Text.StringBuilder 64",
    "`$code = [RefUp]::NHI_DownloadB($Port, '$safeReader', '$safeFile', '$TypeCode', `$local, `$nhi)",
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
    throw (U @(0x4e0a,0x50b3,0x7b49,0x5f85,0x8d85,0x904e,0x20,0x37,0x30,0x20,0x79d2))
  }
  $text = ""
  $err = ""
  if (Test-Path $outFile) { $text = [IO.File]::ReadAllText($outFile) }
  if (Test-Path $errFile) { $err = [IO.File]::ReadAllText($errFile) }
  $code = $null
  $localId = ""
  $nhiId = ""
  foreach ($line in ($text -split "`r?`n")) {
    if ($line.StartsWith("code=")) { $code = [int]$line.Substring(5).Trim() }
    elseif ($line.StartsWith("local=")) { $localId = $line.Substring(6).Trim() }
    elseif ($line.StartsWith("nhi=")) { $nhiId = $line.Substring(4).Trim() }
  }
  return @{ code = $code; localId = $localId; nhiId = $nhiId; exitCode = $proc.ExitCode; err = $err.Trim() }
}

$cfg = Read-Config
$font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 12)
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(1180, 760)
$form.Font = $font

function Add-Field($Panel, [string]$Key, [int[]]$Label, [int]$Y, [int]$H) {
  $lab = New-Object System.Windows.Forms.Label
  $lab.Text = (U $Label)
  $lab.Location = New-Object System.Drawing.Point(8, $Y)
  $lab.Size = New-Object System.Drawing.Size(156, 22)
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point(168, ($Y - 2))
  $box.Size = New-Object System.Drawing.Size(560, $H)
  if ($H -gt 36) {
    $box.Multiline = $true
    $box.ScrollBars = "Vertical"
  }
  $Panel.Controls.Add($lab)
  $Panel.Controls.Add($box)
  return $box
}

function Set-Slip($Slip, [string]$Name, [string]$Value) {
  if ($Slip.PSObject.Properties.Name -contains $Name) { $Slip.$Name = $Value }
  else { $Slip | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force }
}

$lblHost = New-Object System.Windows.Forms.Label
$lblHost.Text = (U @(0x4e3b,0x6a5f))
$lblHost.Location = New-Object System.Drawing.Point(12, 14)
$lblHost.Size = New-Object System.Drawing.Size(48, 28)
$txtHost = New-Object System.Windows.Forms.TextBox
$txtHost.Text = $cfg.host
$txtHost.Location = New-Object System.Drawing.Point(60, 12)
$txtHost.Size = New-Object System.Drawing.Size(280, 28)
$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = (U @(0x69fd))
$lblPort.Location = New-Object System.Drawing.Point(350, 14)
$lblPort.Size = New-Object System.Drawing.Size(36, 28)
$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Text = [string]$cfg.port
$txtPort.Location = New-Object System.Drawing.Point(388, 12)
$txtPort.Size = New-Object System.Drawing.Size(48, 28)
$cboKind = New-Object System.Windows.Forms.ComboBox
$cboKind.DropDownStyle = "DropDownList"
$cboKind.Location = New-Object System.Drawing.Point(448, 12)
$cboKind.Size = New-Object System.Drawing.Size(100, 28)
[void]$cboKind.Items.Add((U @(0x8f49,0x51fa)))
[void]$cboKind.Items.Add((U @(0x56de,0x8986)))
$cboKind.SelectedIndex = 0
$btnLoad = New-Object System.Windows.Forms.Button
$btnLoad.Text = (U @(0x91cd,0x65b0,0x8b80,0x53d6))
$btnLoad.Location = New-Object System.Drawing.Point(560, 10)
$btnLoad.Size = New-Object System.Drawing.Size(110, 32)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = (U @(35469,35657,30475,32,83,65,77,32,27133,65292,19981,26159,32,80,73,78,12290,23384,27284,23531,22238,20027,27231,12290,36865,20986,25165,36208,36889,21488,30340,32,83,65,77,12290))
$hint.Location = New-Object System.Drawing.Point(12, 48)
$hint.Size = New-Object System.Drawing.Size(1140, 24)

$txtFilter = New-Object System.Windows.Forms.TextBox
$txtFilter.Location = New-Object System.Drawing.Point(12, 78)
$txtFilter.Size = New-Object System.Drawing.Size(330, 28)

$list = New-Object System.Windows.Forms.ListView
$list.View = "Details"
$list.FullRowSelect = $true
$list.GridLines = $true
$list.HideSelection = $false
$list.Location = New-Object System.Drawing.Point(12, 112)
$list.Size = New-Object System.Drawing.Size(330, 470)
[void]$list.Columns.Add((U @(26085,26399)), 96)
[void]$list.Columns.Add((U @(22995,21517)), 88)
[void]$list.Columns.Add((U @(0x75c5,0x6b77,0x865f)), 72)
[void]$list.Columns.Add((U @(29376,24907)), 64)

$sheet = New-Object System.Windows.Forms.Panel
$sheet.Location = New-Object System.Drawing.Point(352, 78)
$sheet.Size = New-Object System.Drawing.Size(812, 504)
$sheet.BorderStyle = "FixedSingle"
$sheet.BackColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 14, [System.Drawing.FontStyle]::Bold)
$title.TextAlign = "MiddleCenter"
$title.Location = New-Object System.Drawing.Point(8, 6)
$title.Size = New-Object System.Drawing.Size(790, 28)
$head = New-Object System.Windows.Forms.Label
$head.Location = New-Object System.Drawing.Point(12, 36)
$head.Size = New-Object System.Drawing.Size(790, 22)
$empty = New-Object System.Windows.Forms.Label
$empty.Text = (U @(35531,20808,24478,24038,37002,36984,19968,20301,12290))
$empty.Location = New-Object System.Drawing.Point(16, 80)
$empty.Size = New-Object System.Drawing.Size(760, 28)

$sheetReply = New-Object System.Windows.Forms.Panel
$sheetReply.Location = New-Object System.Drawing.Point(8, 62)
$sheetReply.Size = New-Object System.Drawing.Size(796, 390)
$sheetReply.AutoScroll = $true
$sheetReply.Visible = $false
$sheetOut = New-Object System.Windows.Forms.Panel
$sheetOut.Location = New-Object System.Drawing.Point(8, 62)
$sheetOut.Size = New-Object System.Drawing.Size(796, 390)
$sheetOut.AutoScroll = $true
$sheetOut.Visible = $false

$lblReplyPurpose = New-Object System.Windows.Forms.Label
$lblReplyPurpose.Text = (U @(34389,29702,24773,24418))
$lblReplyPurpose.Location = New-Object System.Drawing.Point(8, 8)
$lblReplyPurpose.Size = New-Object System.Drawing.Size(156, 22)
$cboReplyPurpose = New-Object System.Windows.Forms.ComboBox
$cboReplyPurpose.DropDownStyle = "DropDownList"
$cboReplyPurpose.Location = New-Object System.Drawing.Point(168, 4)
$cboReplyPurpose.Size = New-Object System.Drawing.Size(520, 28)
foreach ($codes in @(
  @(49,46,32,24050,20104,24613,35386,34389,32622,20006,36681,35386,33267,37291,38498),
  @(50,46,32,24050,20104,24613,35386,34389,32622,65292,20006,20303,26412,38498,30149,25151,27835,30274,20013),
  @(51,46,32,24050,23433,25490,20303,26412,38498,30149,25151,27835,30274,20013),
  @(52,46,32,24050,23433,25490,26412,38498,38272,35386,27835,30274,20013),
  @(53,46,32,24050,20104,36969,30070,34389,29702,20006,36681,22238,21407,38498,25152),
  @(54,46,32,20854,20182)
)) { [void]$cboReplyPurpose.Items.Add((U $codes)) }
$cboReplyPurpose.SelectedIndex = 3
$sheetReply.Controls.Add($lblReplyPurpose)
$sheetReply.Controls.Add($cboReplyPurpose)

$script:Reply = @{}
$y = 40
foreach ($field in @(
  @{ key = "serial"; h = 28; label = @(36681,35386,21934,24207,34399) },
  @{ key = "replyDay"; h = 28; label = @(22238,24489,26085,26399) },
  @{ key = "diagnosis"; h = 64; label = @(20027,35386,26039) },
  @{ key = "drugs"; h = 72; label = @(27835,30274,34277,29289,25110,25163,34899,21517,31281) },
  @{ key = "aux"; h = 72; label = @(36628,21161,35386,26039,20043,27298,26597,32080,26524) },
  @{ key = "handoff"; h = 64; label = @(37291,24107,20132,29677,27880,24847,20107,38917) },
  @{ key = "doctor"; h = 28; label = @(35386,27835,37291,24107) },
  @{ key = "dept"; h = 28; label = @(31185,21029) }
)) {
  $script:Reply[$field.key] = Add-Field $sheetReply $field.key $field.label $y $field.h
  $y += $field.h + 10
}

$lblOutPurpose = New-Object System.Windows.Forms.Label
$lblOutPurpose.Text = (U @(0x8f49,0x8a3a,0x76ee,0x7684))
$lblOutPurpose.Location = New-Object System.Drawing.Point(8, 8)
$lblOutPurpose.Size = New-Object System.Drawing.Size(156, 22)
$cboOutPurpose = New-Object System.Windows.Forms.ComboBox
$cboOutPurpose.DropDownStyle = "DropDownList"
$cboOutPurpose.Location = New-Object System.Drawing.Point(168, 4)
$cboOutPurpose.Size = New-Object System.Drawing.Size(520, 28)
foreach ($codes in @(
  @(49,46,32,24613,35386,27835,30274),
  @(50,46,32,20303,38498,27835,30274),
  @(51,46,32,38272,35386,27835,30274),
  @(52,46,32,36914,19968,27493,27298,26597),
  @(53,46,32,36681,22238,36681,20986,25110,36969,30070,20043,38498,25152,32380,32396),
  @(54,46,32,20854,20182,30446,30340)
)) { [void]$cboOutPurpose.Items.Add((U $codes)) }
$cboOutPurpose.SelectedIndex = 3
$sheetOut.Controls.Add($lblOutPurpose)
$sheetOut.Controls.Add($cboOutPurpose)

$script:Out = @{}
$y = 40
foreach ($field in @(
  @{ key = "patientName"; h = 28; label = @(22995,21517) },
  @{ key = "sex"; h = 28; label = @(24615,21029) },
  @{ key = "birth"; h = 28; label = @(20986,29983) },
  @{ key = "idNo"; h = 28; label = @(36523,20998,35657,34399) },
  @{ key = "contact"; h = 28; label = @(32879,32097,20154) },
  @{ key = "phone"; h = 28; label = @(32879,32097,38651,35441) },
  @{ key = "address"; h = 28; label = @(32879,32097,22320,22336) },
  @{ key = "note"; h = 72; label = @(30149,24773,25688,35201) },
  @{ key = "allergyText"; h = 56; label = @(34277,29289,36942,25935,21490) },
  @{ key = "diagnosis"; h = 56; label = @(35386,26039) },
  @{ key = "historyText"; h = 64; label = @(26368,36817,19968,27425,27298,26597,32080,26524) },
  @{ key = "treatText"; h = 64; label = @(26368,36817,19968,27425,29992,34277,25110,25163,34899) },
  @{ key = "doctor"; h = 28; label = @(35386,27835,37291,24107) },
  @{ key = "dept"; h = 28; label = @(31185,21029) },
  @{ key = "destHosp"; h = 28; label = @(36681,20837,38498,25152) },
  @{ key = "destCode"; h = 28; label = @(38498,25152,20195,30908) },
  @{ key = "destDept"; h = 28; label = @(36681,20837,31185,21029) },
  @{ key = "destDoctor"; h = 28; label = @(36681,20837,37291,24107) },
  @{ key = "destAddr"; h = 28; label = @(22320,22336) },
  @{ key = "destTel"; h = 28; label = @(38651,35441) },
  @{ key = "validUntil"; h = 28; label = @(26377,25928,26399,38480) },
  @{ key = "serial"; h = 28; label = @(24207,34399) }
)) {
  $script:Out[$field.key] = Add-Field $sheetOut $field.key $field.label $y $field.h
  $y += $field.h + 8
}

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = (U @(23384,27284))
$btnSave.Location = New-Object System.Drawing.Point(168, 460)
$btnSave.Size = New-Object System.Drawing.Size(100, 34)
$btnSend = New-Object System.Windows.Forms.Button
$btnSend.Text = (U @(36865,20986))
$btnSend.Location = New-Object System.Drawing.Point(276, 460)
$btnSend.Size = New-Object System.Drawing.Size(100, 34)
$sheet.Controls.AddRange(@($title, $head, $empty, $sheetReply, $sheetOut, $btnSave, $btnSend))

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ScrollBars = "Vertical"
$log.ReadOnly = $true
$log.Location = New-Object System.Drawing.Point(12, 592)
$log.Size = New-Object System.Drawing.Size(1152, 156)

$form.Controls.AddRange(@($lblHost, $txtHost, $lblPort, $txtPort, $cboKind, $btnLoad, $hint, $txtFilter, $list, $sheet, $log))

$script:Rows = @()
$script:Doctors = @()
$script:Profile = @{}

function Add-Log([string]$Line) {
  $log.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format "HH:mm:ss"), $Line))
}

function Current-Base {
  return $txtHost.Text.Trim().TrimEnd("/")
}

function Current-Kind {
  if ($cboKind.SelectedIndex -eq 1) { return "reply" }
  return "out"
}

function Fill-List {
  $list.Items.Clear()
  $needle = $txtFilter.Text.Trim()
  foreach ($row in $script:Rows) {
    $blob = "$($row.patientName) $($row.medicalNo) $($row.serial) $($row.destHosp)"
    if ($needle -and $blob.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    $item = New-Object System.Windows.Forms.ListViewItem "$($row.openedOn)"
    [void]$item.SubItems.Add("$($row.patientName)")
    [void]$item.SubItems.Add("$($row.medicalNo)")
    [void]$item.SubItems.Add("$($row.status)")
    $item.Tag = $row
    [void]$list.Items.Add($item)
  }
}

function Show-Slip {
  if ($list.SelectedItems.Count -lt 1) {
    $sheetOut.Visible = $false
    $sheetReply.Visible = $false
    $empty.Visible = $true
    $title.Text = ""
    $head.Text = ""
    return
  }
  $row = $list.SelectedItems[0].Tag
  $reply = "$($row.kind)" -eq "reply"
  $empty.Visible = $false
  $sheetReply.Visible = $reply
  $sheetOut.Visible = -not $reply
  $head.Text = "$($row.patientName)  $($row.medicalNo)  $($row.idNo)"
  $pick = 3
  $purpose = "$($row.purpose)".Trim()
  if ($purpose.Length -ge 1 -and $purpose.Substring(0, 1) -match "^[1-6]$") { $pick = [int]$purpose.Substring(0, 1) - 1 }
  if ($reply) {
    $title.Text = (U @(25509,21463,37291,38498,35386,30274,25688,35201))
    foreach ($key in @("serial", "diagnosis", "drugs", "aux", "handoff", "doctor", "dept")) {
      $script:Reply[$key].Text = "$($row.$key)"
    }
    if (-not $script:Reply.drugs.Text.Trim()) { $script:Reply.drugs.Text = "$($row.treatText)" }
    if (-not $script:Reply.aux.Text.Trim()) { $script:Reply.aux.Text = "$($row.historyText)" }
    $day = "$($row.openedOn)".Trim()
    if (-not $day) { $day = (Get-Date).ToString("yyyy-MM-dd") }
    $script:Reply.replyDay.Text = $day
    $cboReplyPurpose.SelectedIndex = $pick
  } else {
    $title.Text = (U @(20840,27665,20581,24247,20445,38570,12288,38498,40,25152,41,36681,35386,21934))
    foreach ($key in @($script:Out.Keys)) { $script:Out[$key].Text = "$($row.$key)" }
    $cboOutPurpose.SelectedIndex = $pick
  }
}

function Sync-Slip {
  if ($list.SelectedItems.Count -lt 1) { return $null }
  $slip = $list.SelectedItems[0].Tag
  if ("$($slip.kind)" -eq "reply") {
    foreach ($key in @("serial", "replyDay", "diagnosis", "drugs", "aux", "handoff", "doctor", "dept")) {
      Set-Slip $slip $key $script:Reply[$key].Text.Trim()
    }
    Set-Slip $slip "purpose" ([string]($cboReplyPurpose.SelectedIndex + 1))
    Set-Slip $slip "note" $script:Reply.handoff.Text.Trim()
  } else {
    foreach ($key in @($script:Out.Keys)) { Set-Slip $slip $key $script:Out[$key].Text.Trim() }
    Set-Slip $slip "purpose" ([string]($cboOutPurpose.SelectedIndex + 1))
  }
  return $slip
}

function Save-Slip($Slip, [string]$Status) {
  $body = @{
    id = "$($Slip.id)"
    kind = "$($Slip.kind)"
    encounterId = "$($Slip.encounterId)"
    patientName = "$($Slip.patientName)"
    medicalNo = "$($Slip.medicalNo)"
    idNo = "$($Slip.idNo)"
    destHosp = "$($Slip.destHosp)"
    destCode = "$($Slip.destCode)"
    dept = "$($Slip.dept)"
    purpose = "$($Slip.purpose)"
    doctor = "$($Slip.doctor)"
    diagnosis = "$($Slip.diagnosis)"
    note = "$($Slip.note)"
    serial = "$($Slip.serial)"
    validUntil = "$($Slip.validUntil)"
    status = $Status
    openedOn = "$($Slip.openedOn)"
    historyText = "$($Slip.historyText)"
    treatText = "$($Slip.treatText)"
    sex = "$($Slip.sex)"
    birth = "$($Slip.birth)"
    phone = "$($Slip.phone)"
    address = "$($Slip.address)"
    contact = "$($Slip.contact)"
    allergyText = "$($Slip.allergyText)"
    destDept = "$($Slip.destDept)"
    destDoctor = "$($Slip.destDoctor)"
    destTel = "$($Slip.destTel)"
    destAddr = "$($Slip.destAddr)"
    handoff = "$($Slip.handoff)"
    drugs = "$($Slip.drugs)"
    aux = "$($Slip.aux)"
  }
  $saved = Post-Api (Current-Base) "/nhi/v1/referral/slips" $body
  if (-not $saved.ok) { throw "$($saved.reason)" }
  return $saved
}

$txtFilter.Add_TextChanged({ Fill-List })
$list.Add_SelectedIndexChanged({ Show-Slip })

$btnLoad.Add_Click({
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnLoad.Enabled = $false
  try {
    $base = Current-Base
    $port = 0
    [void][int]::TryParse($txtPort.Text.Trim(), [ref]$port)
    Save-Config $base $port
    $kind = Current-Kind
    $slips = Get-Api $base "/nhi/v1/referral/slips?kind=$kind"
    $docs = Get-Api $base "/nhi/v1/referral/physicians"
    $profile = Get-Api $base "/clinic/settings/profile"
    $script:Rows = @($slips.items)
    $script:Doctors = @($docs.items)
    $script:Profile = $profile.data.profile
    Fill-List
    Show-Slip
    Add-Log ((U @(0x8b80,0x5230,0x20)) + $list.Items.Count + (U @(0x20,0x7b46,0x3002)))
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnLoad.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

$btnSave.Add_Click({
  $slip = Sync-Slip
  if (-not $slip) {
    Add-Log (U @(0x8acb,0x5148,0x9078,0x4e00,0x7b46,0x3002))
    return
  }
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnSave.Enabled = $false
  try {
    $status = "$($slip.status)".Trim()
    if (-not $status) { $status = (U @(24050,23384,27284)) }
    [void](Save-Slip $slip $status)
    if ($list.SelectedItems.Count -gt 0) { $list.SelectedItems[0].SubItems[3].Text = $status }
    Add-Log (U @(24050,23384,27284,65292,27794,26377,36865,20986,12290))
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnSave.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

$btnSend.Add_Click({
  $slip = Sync-Slip
  if (-not $slip) {
    Add-Log (U @(0x8acb,0x5148,0x9078,0x4e00,0x7b46,0x3002))
    return
  }
  $port = 0
  [void][int]::TryParse($txtPort.Text.Trim(), [ref]$port)
  $state = Get-AuthState $port
  foreach ($line in $state.lines) { Add-Log $line }
  if (-not $state.ready) { return }
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnSend.Enabled = $false
  try {
    $dll = $state.dll.path
    $reader = "$($state.reader)"
    $profile = $script:Profile
    $hosp = "$($profile.clinicCode)".Trim()
    $phone = "$($profile.phone)".Trim()
    $doctor = Find-DoctorId $slip $script:Doctors
    $missing = @()
    if (-not "$($slip.idNo)".Trim()) { $missing += (U @(0x8eab,0x5206,0x8b49)) }
    if (-not $doctor) { $missing += (U @(0x91ab,0x5e2b,0x8eab,0x5206,0x8b49)) }
    if ("$($slip.kind)" -eq "reply") {
      if (-not "$($slip.serial)".Trim()) { $missing += (U @(0x8f49,0x8a3a,0x55ae,0x5e8f,0x865f)) }
      if (-not $phone) { $missing += (U @(0x9662,0x6240,0x96fb,0x8a71)) }
      if (-not (Convert-Icd "$($slip.diagnosis)")) { $missing += (U @(0x4e3b,0x8a3a,0x65b7,0x4ee3,0x78bc)) }
      $typeCode = "04"
      $status = (U @(0x5df2,0x56de,0x8986))
      $prefix = "ETB"
      $xml = Build-ReplyXml $slip $hosp $doctor $phone "$($profile.email)"
    } else {
      if (-not "$($slip.patientName)".Trim()) { $missing += (U @(0x59d3,0x540d)) }
      if (-not "$($slip.phone)".Trim()) { $missing += (U @(0x96fb,0x8a71)) }
      if (-not "$($slip.note)".Trim()) { $missing += (U @(0x75c5,0x60c5,0x6458,0x8981)) }
      if (-not "$($slip.diagnosis)".Trim()) { $missing += (U @(0x4e3b,0x8a3a,0x65b7)) }
      if (-not "$($slip.destCode)".Trim()) { $missing += (U @(0x8f49,0x5165,0x9662,0x6240,0x4ee3,0x78bc)) }
      $typeCode = "10"
      $status = (U @(0x5df2,0x4e0a,0x50b3))
      $prefix = "ETA"
      $xml = Build-OpenXml $slip $hosp $doctor $phone "$($profile.address)" "$($profile.email)"
    }
    if (-not $hosp) { $missing += (U @(0x9662,0x6240,0x4ee3,0x78bc)) }
    if ($missing.Count -gt 0) {
      throw ((U @(0x9084,0x7f3a,0xff1a)) + ($missing -join (U @(0x3001))) + (U @(0x3002,0x6c92,0x6709,0x9001,0x51fa,0x3002)))
    }
    [void](Save-Slip $slip "$($slip.status)")
    $roc = "{0:000}{1}" -f ((Get-Date).Year - 1911), (Get-Date).ToString("MMdd")
    $stamp = (Get-Date).ToString("HHmmss")
    $name = $prefix + $hosp + "-" + $roc + $stamp.Substring(3) + ".xml"
    $dir = "C:\Temp\psehr-refup"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir $name
    $enc = [Text.Encoding]::GetEncoding(950)
    [IO.File]::WriteAllBytes($file, $enc.GetBytes($xml))
    $sent = Invoke-DownloadB $dll $reader $file $typeCode $port
    if ($null -eq $sent.code) {
      $detail = "$($sent.err)".Trim()
      if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
      if (-not $detail) { $detail = "exit $($sent.exitCode)" }
      throw $detail
    }
    if ($sent.code -ne 0) { throw (Explain-UploadCode ([int]$sent.code)) }
    Post-Api (Current-Base) "/nhi/v1/referral/result" @{
      id = "$($slip.id)"
      localId = "$($sent.localId)"
      nhiId = "$($sent.nhiId)"
      status = $status
    } | Out-Null
    Set-Slip $slip "status" $status
    if ($list.SelectedItems.Count -gt 0) { $list.SelectedItems[0].SubItems[3].Text = $status }
    Add-Log ((U @(0x5df2,0x4ea4,0x51fa,0x3002,0x672c,0x5730,0x7de8,0x865f,0x20)) + $sent.localId + (U @(0x3000,0x5065,0x4fdd,0x7de8,0x865f,0x20)) + $sent.nhiId)
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnSend.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

$form.Add_Shown({
  $port = 0
  [void][int]::TryParse($txtPort.Text.Trim(), [ref]$port)
  $state = Get-AuthState $port
  foreach ($line in $state.lines) { Add-Log $line }
  if (-not $state.ready) { $btnSend.Enabled = $false }
})

[void]$form.ShowDialog()
