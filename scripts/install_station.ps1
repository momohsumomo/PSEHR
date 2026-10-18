# This PC is not the chart host. It only runs the local print agent and opens the host.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { throw "Install Python 3.12 first, or install winget and run again." }
  & winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
}
if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
  & python -m venv (Join-Path $Root ".venv")
}
& (Join-Path $Root ".venv\Scripts\python.exe") -m pip install -r (Join-Path $Root "requirements.txt")

$dir = Join-Path $env:LOCALAPPDATA "PSEHR"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$hostFile = Join-Path $dir "host.txt"
$ip = ""
if (Test-Path $hostFile) { $ip = (Get-Content $hostFile -Raw).Trim() }
if (-not $ip) {
  $ip = Read-Host "Host IP (the exam computer)"
  Set-Content -Path $hostFile -Value $ip.Trim() -Encoding ASCII
}

$vbs = Join-Path $Root "scripts\psehr_protocol.vbs"
$cmd = "wscript.exe //nologo `"$vbs`" `"%1`""
New-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Force | Out-Null
Set-Item -Path "HKCU:\Software\Classes\psehr" -Value "URL:PSEHR"
New-ItemProperty -Path "HKCU:\Software\Classes\psehr" -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Value $cmd

$startup = [Environment]::GetFolderPath("Startup")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $startup "PSEHR-print.lnk"))
$link.TargetPath = "wscript.exe"
$link.Arguments = "//nologo `"$(Join-Path $Root 'scripts\launch_station.vbs')`""
$link.WorkingDirectory = $Root
$link.WindowStyle = 7
$link.Save()

$desk = [Environment]::GetFolderPath("Desktop")
$open = $shell.CreateShortcut((Join-Path $desk "PSEHR-open-host.lnk"))
$open.TargetPath = "wscript.exe"
$open.Arguments = "//nologo `"$(Join-Path $Root 'scripts\open_host.vbs')`""
$open.WorkingDirectory = $Root
$open.WindowStyle = 7
$open.Save()
Write-Host "Station ready. Charts stay on the host. This PC only prints and opens the host page."
