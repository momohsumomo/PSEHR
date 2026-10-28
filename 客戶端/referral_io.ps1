# Cloud SAM referral file. NHI_DownloadB sends. NHI_GetB picks up the list.
# Runs in 32-bit PowerShell. Prints one JSON object.
param([string]$RequestFile)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($json)
}

function Clean-Id([string]$raw) {
  $buf = New-Object System.Text.StringBuilder
  foreach ($ch in $raw.ToCharArray()) {
    if ([string]$ch -match "[A-Za-z0-9_]") { [void]$buf.Append($ch) }
  }
  return $buf.ToString()
}

function Find-CloudDll {
  foreach ($path in @("Z:\SC\DLL\nhi_eiiapi.dll", "Z:\SC\nhi_eiiapi.dll")) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $bytes = [IO.File]::ReadAllBytes($path)
    $text = [Text.Encoding]::ASCII.GetString($bytes)
    if ($text.Contains("C:\NHI\SAM\COMX") -and $text.Contains("NHI_DownloadB")) { return $path }
  }
  return ""
}

if (-not (Test-Path -LiteralPath $RequestFile)) {
  Write-Result @{ ok = $false; reason = "missing request" }
  exit 0
}
$req = [IO.File]::ReadAllText($RequestFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
$dll = Find-CloudDll
if (-not $dll) {
  Write-Result @{ ok = $false; reason = "cloud dll missing" }
  exit 0
}
$root = "C:\Temp\psehr-refup"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$op = "$($req.op)"
if ($op -eq "fetch") {
  $local = Clean-Id "$($req.localId)"
  $nhi = Clean-Id "$($req.nhiId)"
  $dest = Join-Path $root ("in-" + $local)
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $code = & {
    Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class RefIo {
  [DllImport(@"$dll", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]
  public static extern int NHI_GetB(int port, string reader, string localId, string nhiId, string downloadPath);
}
"@
    [RefIo]::NHI_GetB(0, "", $local, $nhi, $dest)
  }
  $csv = ""
  $zips = @(Get-ChildItem -LiteralPath $dest -Recurse -Filter "*.zip" -ErrorAction SilentlyContinue)
  foreach ($zip in $zips) {
    $unpack = Join-Path $dest ("z-" + $zip.BaseName)
    New-Item -ItemType Directory -Force -Path $unpack | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip.FullName, $unpack)
  }
  $found = @(Get-ChildItem -LiteralPath $dest -Recurse -Filter "*.csv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($found.Count -gt 0) { $csv = $found[0].FullName }
  $rows = @()
  if ($csv) {
    $enc = [Text.Encoding]::GetEncoding(950)
    $text = $enc.GetString([IO.File]::ReadAllBytes($csv))
    $lines = @($text -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
    $header = $false
    $cols = @()
    if ($lines.Count -gt 0 -and $lines[0].Contains(",")) {
      $first = $lines[0].Split(",")
      if ($first[0] -notmatch "^\d{16}$") { $header = $true; $cols = $first }
    }
    $start = 0
    if ($header) { $start = 1 }
    for ($i = $start; $i -lt $lines.Count; $i++) {
      $parts = $lines[$i].Split(",")
      $row = @{}
      if ($header) {
        for ($c = 0; $c -lt $cols.Count -and $c -lt $parts.Count; $c++) {
          $row[$cols[$c].Trim()] = $parts[$c].Trim()
        }
      } else {
        $row.serial = ""
        $row.idNo = ""
        $row.patientName = ""
        $row.openDate = ""
        $row.validUntil = ""
        $row.hospId = ""
        $row.hospName = ""
        $row.status = ""
        $row.selfSeq = ""
        $row.contact = ""
        $map = @(
          @(0, "serial"), @(1, "idNo"), @(2, "patientName"), @(6, "openDate"),
          @(7, "validUntil"), @(16, "hospId"), @(17, "hospName"), @(23, "status"),
          @(26, "selfSeq"), @(30, "contact")
        )
        foreach ($pair in $map) {
          $n = [int]$pair[0]
          if ($n -lt $parts.Length) { $row[$pair[1]] = $parts[$n].Trim() }
        }
      }
      $rows += $row
    }
  }
  Write-Result @{ ok = ($code -eq 0); code = $code; localId = $local; nhiId = $nhi; rows = $rows }
  exit 0
}

$name = "$($req.name)"
if ($name -notmatch "^[A-Za-z0-9._-]+$") {
  Write-Result @{ ok = $false; reason = "bad file name" }
  exit 0
}
$bytes = [Convert]::FromBase64String("$($req.b64)")
$file = Join-Path $root $name
[IO.File]::WriteAllBytes($file, $bytes)
$type = "$($req.type)"
if ($type -notmatch "^\d{2}$") { $type = "10" }
$local = New-Object System.Text.StringBuilder 64
$nhi = New-Object System.Text.StringBuilder 64
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
using System.Text;
public class RefSend {
  [DllImport(@"$dll", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]
  public static extern int NHI_DownloadB(int port, string reader, string file, string typeCode, StringBuilder localId, StringBuilder nhiId);
}
"@
$code = [RefSend]::NHI_DownloadB(0, "", $file, $type, $local, $nhi)
$localId = Clean-Id $local.ToString()
$nhiId = Clean-Id $nhi.ToString()
Write-Result @{ ok = ($code -eq 0 -and $localId.Length -ge 4); code = $code; localId = $localId; nhiId = $nhiId }
exit 0
