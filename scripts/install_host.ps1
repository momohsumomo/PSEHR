# Install Python, Node, and this clinic app on the HOST computer. Shows its own window.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Ensure-Winget([string]$Id) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host "winget is not installed. Install Python 3.12 and Node.js LTS, then run this again."
    return
  }
  & winget install -e --id $Id --accept-package-agreements --accept-source-agreements
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Ensure-Winget "Python.Python.3.12"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Ensure-Winget "OpenJS.NodeJS.LTS"
}

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "python is still missing" }
if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
  & python -m venv (Join-Path $Root ".venv")
}
& (Join-Path $Root ".venv\Scripts\python.exe") -m pip install -r (Join-Path $Root "requirements.txt")
Push-Location (Join-Path $Root "frontend")
if (-not (Test-Path "node_modules")) { npm install }
Pop-Location

$vbs = Join-Path $Root "scripts\psehr_protocol.vbs"
$cmd = "wscript.exe //nologo `"$vbs`" `"%1`""
New-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Force | Out-Null
Set-Item -Path "HKCU:\Software\Classes\psehr" -Value "URL:PSEHR"
New-ItemProperty -Path "HKCU:\Software\Classes\psehr" -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path "HKCU:\Software\Classes\psehr\shell\open\command" -Value $cmd

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\host_service.ps1") -Action autostart
Write-Host "Host tools are installed. After you sign in to Windows, the clinic service starts itself. Other PCs use the client folder."
