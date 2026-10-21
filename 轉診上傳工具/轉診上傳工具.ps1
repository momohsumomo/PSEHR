# Referral upload on a PC that does not run card software 6.0.
# Reads slips from the clinic host and writes the bureau receipt back.
# The upload call is NHI_DownloadB. It does not take a patient card or a doctor-card PIN.
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
  $override = [Environment]::GetEnvironmentVariable("NHI_EIIAPI_DLL")
  if ($override -and (Test-Path -LiteralPath $override)) { return $override }
  $path = "Z:\SC\nhi_eiiapi.dll"
  if (Test-Path -LiteralPath $path) { return $path }
  return ""
}

function Get-Api([string]$Base, [string]$Path) {
  return Invoke-RestMethod -Uri ($Base.TrimEnd("/") + $Path) -TimeoutSec 20
}

function Post-Api([string]$Base, [string]$Path, $Body) {
  $json = $Body | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Uri ($Base.TrimEnd("/") + $Path) -Method POST -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 20
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
    @("h5", (Get-Date).ToString("yyyyMMdd")),
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
$form.ClientSize = New-Object System.Drawing.Size(980, 680)
$form.Font = $font

$lblHost = New-Object System.Windows.Forms.Label
$lblHost.Text = (U @(0x4e3b,0x6a5f))
$lblHost.Location = New-Object System.Drawing.Point(16, 16)
$lblHost.Size = New-Object System.Drawing.Size(48, 28)
$txtHost = New-Object System.Windows.Forms.TextBox
$txtHost.Text = $cfg.host
$txtHost.Location = New-Object System.Drawing.Point(68, 14)
$txtHost.Size = New-Object System.Drawing.Size(360, 28)
$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = "COM"
$lblPort.Location = New-Object System.Drawing.Point(440, 16)
$lblPort.Size = New-Object System.Drawing.Size(48, 28)
$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Text = [string]$cfg.port
$txtPort.Location = New-Object System.Drawing.Point(492, 14)
$txtPort.Size = New-Object System.Drawing.Size(48, 28)
$cboKind = New-Object System.Windows.Forms.ComboBox
$cboKind.DropDownStyle = "DropDownList"
$cboKind.Location = New-Object System.Drawing.Point(552, 14)
$cboKind.Size = New-Object System.Drawing.Size(120, 28)
[void]$cboKind.Items.Add((U @(0x8f49,0x51fa)))
[void]$cboKind.Items.Add((U @(0x56de,0x8986)))
$cboKind.SelectedIndex = 0
$btnLoad = New-Object System.Windows.Forms.Button
$btnLoad.Text = (U @(0x91cd,0x65b0,0x8b80,0x53d6))
$btnLoad.Location = New-Object System.Drawing.Point(684, 12)
$btnLoad.Size = New-Object System.Drawing.Size(120, 32)
$btnSend = New-Object System.Windows.Forms.Button
$btnSend.Text = (U @(0x4e0a,0x50b3,0x9078,0x53d6,0x7684,0x9019,0x4e00,0x7b46))
$btnSend.Location = New-Object System.Drawing.Point(816, 12)
$btnSend.Size = New-Object System.Drawing.Size(148, 32)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = (U @(0x53ea,0x4e0a,0x50b3,0x3002,0x4e0d,0x4f7f,0x7528,0x8b80,0x5361,0x8edf,0x9ad4,0x20,0x36,0x2e,0x30,0xff0c,0x4e5f,0x4e0d,0x63d2,0x5361,0x3002,0x8f49,0x51fa,0x7a2e,0x985e,0x20,0x31,0x30,0xff0c,0x56de,0x8986,0x7a2e,0x985e,0x20,0x30,0x34,0x3002))
$hint.Location = New-Object System.Drawing.Point(16, 52)
$hint.Size = New-Object System.Drawing.Size(940, 28)

$list = New-Object System.Windows.Forms.ListView
$list.View = "Details"
$list.FullRowSelect = $true
$list.GridLines = $true
$list.Location = New-Object System.Drawing.Point(16, 88)
$list.Size = New-Object System.Drawing.Size(948, 380)
[void]$list.Columns.Add((U @(0x7a2e,0x985e)), 70)
[void]$list.Columns.Add((U @(0x59d3,0x540d)), 120)
[void]$list.Columns.Add((U @(0x75c5,0x6b77,0x865f)), 90)
[void]$list.Columns.Add((U @(0x8f49,0x5165)), 180)
[void]$list.Columns.Add((U @(0x65e5,0x671f)), 110)
[void]$list.Columns.Add((U @(0x72c0,0x614b)), 90)
[void]$list.Columns.Add((U @(0x5e8f,0x865f)), 180)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ScrollBars = "Vertical"
$log.ReadOnly = $true
$log.Location = New-Object System.Drawing.Point(16, 480)
$log.Size = New-Object System.Drawing.Size(948, 180)

$form.Controls.AddRange(@($lblHost, $txtHost, $lblPort, $txtPort, $cboKind, $btnLoad, $btnSend, $hint, $list, $log))

$script:Rows = @()
$script:Doctors = @()
$script:Profile = @{}

function Add-Log([string]$Line) {
  $log.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format "HH:mm:ss"), $Line))
}

function Current-Base {
  return $txtHost.Text.Trim().TrimEnd("/")
}

$btnLoad.Add_Click({
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnLoad.Enabled = $false
  try {
    $base = Current-Base
    Save-Config $base ([int]$txtPort.Text)
    $kind = "out"
    if ($cboKind.SelectedIndex -eq 1) { $kind = "reply" }
    $slips = Get-Api $base "/nhi/v1/referral/slips?kind=$kind"
    $docs = Get-Api $base "/nhi/v1/referral/physicians"
    $profile = Get-Api $base "/clinic/settings/profile"
    $script:Rows = @($slips.items)
    $script:Doctors = @($docs.items)
    $script:Profile = $profile.data.profile
    $list.Items.Clear()
    foreach ($row in $script:Rows) {
      $label = (U @(0x8f49,0x51fa))
      if ("$($row.kind)" -eq "reply") { $label = (U @(0x56de,0x8986)) }
      $item = New-Object System.Windows.Forms.ListViewItem $label
      [void]$item.SubItems.Add("$($row.patientName)")
      [void]$item.SubItems.Add("$($row.medicalNo)")
      [void]$item.SubItems.Add("$($row.destHosp)")
      [void]$item.SubItems.Add("$($row.openedOn)")
      [void]$item.SubItems.Add("$($row.status)")
      [void]$item.SubItems.Add("$($row.serial)")
      $item.Tag = $row
      [void]$list.Items.Add($item)
    }
    Add-Log ((U @(0x8b80,0x5230,0x20)) + $script:Rows.Count + (U @(0x20,0x7b46,0x3002)))
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnLoad.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

$btnSend.Add_Click({
  if ($list.SelectedItems.Count -lt 1) {
    Add-Log (U @(0x8acb,0x5148,0x9078,0x4e00,0x7b46,0x3002))
    return
  }
  if (Test-SixRunning) {
    Add-Log (U @(0x9019,0x53f0,0x6b63,0x5728,0x8dd1,0x8b80,0x5361,0x8edf,0x9ad4,0x20,0x36,0x2e,0x30,0x3002,0x9019,0x500b,0x5de5,0x5177,0x4e0d,0x80fd,0x5728,0x9019,0x53f0,0x4e0a,0x50b3,0x3002))
    return
  }
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  $btnSend.Enabled = $false
  try {
    $slip = $list.SelectedItems[0].Tag
    $dll = Find-UploadDll
    $reader = Find-ReaderDll
    if (-not $dll) { throw (U @(0x627e,0x4e0d,0x5230,0x4e0a,0x50b3,0x7a0b,0x5f0f,0x20,0x6e,0x68,0x69,0x5f,0x65,0x69,0x69,0x61,0x70,0x69,0x2e,0x64,0x6c,0x6c,0x3002)) }
    if (-not $reader) { throw (U @(0x627e,0x4e0d,0x5230,0x8b80,0x5361,0x6a5f,0x20,0x52,0x65,0x61,0x64,0x65,0x72,0x2e,0x64,0x6c,0x6c,0x3002,0x6c92,0x6709,0x9001,0x51fa,0x3002)) }
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
    $roc = "{0:000}{1}" -f ((Get-Date).Year - 1911), (Get-Date).ToString("MMdd")
    $stamp = (Get-Date).ToString("HHmmss")
    $name = $prefix + $hosp + "-" + $roc + $stamp.Substring(3) + ".xml"
    $dir = "C:\Temp\psehr-refup"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir $name
    $enc = [Text.Encoding]::GetEncoding(950)
    [IO.File]::WriteAllBytes($file, $enc.GetBytes($xml))
    $sent = Invoke-DownloadB $dll $reader $file $typeCode ([int]$txtPort.Text)
    if ($null -eq $sent.code) {
      $detail = "$($sent.err)".Trim()
      if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
      if (-not $detail) { $detail = "exit $($sent.exitCode)" }
      throw $detail
    }
    if ($sent.code -eq 5010) {
      throw (U @(0x4e0a,0x50b3,0x51fd,0x5f0f,0x56de,0x20,0x35,0x30,0x31,0x30,0x3002,0x58,0x4d,0x4c,0x20,0x5df2,0x7167,0x6279,0x6b21,0x683c,0x5f0f,0x7d44,0x597d,0x4e26,0x4ea4,0x7d66,0x20,0x4e,0x48,0x49,0x5f,0x44,0x6f,0x77,0x6e,0x6c,0x6f,0x61,0x64,0x42,0xff0c,0x9019,0x6b21,0x6c92,0x6709,0x88ab,0x6536,0x4e0b,0x3002))
    }
    if ($sent.code -ne 0) {
      $why = (U @(0x4e0a,0x50b3,0x51fd,0x5f0f,0x56de,0x20)) + $sent.code + (U @(0x3002,0x6a94,0x6848,0x6c92,0x6709,0x4ea4,0x51fa,0x53bb,0x3002))
      throw $why
    }
    Post-Api (Current-Base) "/nhi/v1/referral/result" @{
      id = "$($slip.id)"
      localId = "$($sent.localId)"
      nhiId = "$($sent.nhiId)"
      status = $status
    } | Out-Null
    Add-Log ((U @(0x5df2,0x4ea4,0x51fa,0x3002,0x672c,0x5730,0x7de8,0x865f,0x20)) + $sent.localId + (U @(0x3000,0x5065,0x4fdd,0x7de8,0x865f,0x20)) + $sent.nhiId)
    $list.SelectedItems[0].SubItems[5].Text = $status
  } catch {
    Add-Log $_.Exception.Message
  } finally {
    $btnSend.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
})

if (Test-SixRunning) {
  Add-Log (U @(0x9019,0x53f0,0x6b63,0x5728,0x8dd1,0x8b80,0x5361,0x8edf,0x9ad4,0x20,0x36,0x2e,0x30,0x3002,0x8acb,0x6539,0x5230,0x6c92,0x6709,0x88dd,0x20,0x36,0x2e,0x30,0x20,0x7684,0x90a3,0x4e00,0x53f0,0x3002))
  $btnSend.Enabled = $false
}

[void]$form.ShowDialog()
