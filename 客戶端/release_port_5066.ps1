# Release Windows TCP exclusion that covers 5066 so card software 6.0 can bind.
# Hyper-V / WinNAT exclusions marked * cannot be deleted with netsh; stopping WinNAT drops them.
$ErrorActionPreference = "Continue"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  exit 3
}

$Root = Join-Path $env:LOCALAPPDATA "PSEHR"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$Result = Join-Path $Root "port5066-result.txt"

function Test-PortExcluded([int]$Port) {
  foreach ($family in @("ipv4", "ipv6")) {
    $raw = netsh int $family show excludedportrange protocol=tcp | Out-String
    foreach ($line in ($raw -split "`r?`n")) {
      if ($line -match "^\s*(\d+)\s+(\d+)") {
        $start = [int]$Matches[1]
        $end = [int]$Matches[2]
        if ($Port -ge $start -and $Port -le $end) { return $true }
      }
    }
  }
  return $false
}

function Test-PortListening([int]$Port) {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$conns
}

function Show-Note([int[]]$Codes) {
  Add-Type -AssemblyName System.Windows.Forms
  $msg = -join ($Codes | ForEach-Object { [char]$_ })
  $title = -join (@(0x958B, 0x555F, 0x9580, 0x8A3A) | ForEach-Object { [char]$_ })
  [System.Windows.Forms.MessageBox]::Show($msg, $title) | Out-Null
}

if (-not (Test-PortExcluded 5066)) {
  Set-Content -Path $Result -Value "free" -Encoding ASCII
  exit 0
}

netsh int ipv4 set dynamicport tcp start=49152 num=16384 | Out-Null
netsh int ipv4 set dynamicport udp start=49152 num=16384 | Out-Null
netsh int ipv6 set dynamicport tcp start=49152 num=16384 | Out-Null
netsh int ipv6 set dynamicport udp start=49152 num=16384 | Out-Null

net stop winnat | Out-Null
Start-Sleep -Seconds 2
try { Restart-Service hns -Force -ErrorAction Stop } catch {}
net start winnat | Out-Null
Start-Sleep -Seconds 2

if (Test-PortExcluded 5066) {
  net stop winnat | Out-Null
  Start-Sleep -Seconds 2
}

Get-Process ciet6001s01, cies6001s04 -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

$pf86 = ${env:ProgramFiles(x86)}
if (-not $pf86) { $pf86 = "C:\Program Files (x86)" }
$exe = Join-Path $pf86 "NHI\cshis6\ciet6001s01.exe"
if (Test-Path -LiteralPath $exe) {
  try {
    Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service SCardSvr -ErrorAction SilentlyContinue
  } catch {}
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PortListening 5066) { break }
  }
}

try { net start winnat | Out-Null } catch {}

$free = -not (Test-PortExcluded 5066) -or (Test-PortListening 5066)
if ($free) {
  Set-Content -Path $Result -Value "free" -Encoding ASCII
  Show-Note @(
    0x0035, 0x0030, 0x0036, 0x0036, 0x0020,
    0x7684, 0x7CFB, 0x7D71, 0x4FDD, 0x7559, 0x5DF2, 0x653E, 0x958B, 0xFF0C,
    0x8B80, 0x5361, 0x8EDF, 0x9AD4, 0x0020, 0x0036, 0x002E, 0x0030, 0x0020,
    0x53EF, 0x4EE5, 0x555F, 0x52D5, 0x3002
  )
  exit 0
}

Set-Content -Path $Result -Value "held" -Encoding ASCII
Show-Note @(
  0x0035, 0x0030, 0x0036, 0x0036, 0x0020,
  0x4ECD, 0x5728, 0x7CFB, 0x7D71, 0x4FDD, 0x7559, 0x7BC4, 0x570D, 0x3002,
  0x8ACB, 0x91CD, 0x65B0, 0x958B, 0x6A5F, 0x5F8C, 0xFF0C,
  0x518D, 0x96D9, 0x64CA, 0x4E00, 0x6B21, 0x300C, 0x958B, 0x555F, 0x9580, 0x8A3A, 0x300D, 0x3002
)
exit 1
