@echo off
cd /d "%~dp0"
if exist "%~dp0scripts\setup_wizard.ps1" (
  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\setup_wizard.ps1"
  exit /b %ERRORLEVEL%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/momohsumomo/PSEHR/main/scripts/setup_wizard.ps1' -OutFile ($env:TEMP + '\psehr-setup.ps1')"
if errorlevel 1 (
  echo GitHub did not return the installer.
  pause
  exit /b 1
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%TEMP%\psehr-setup.ps1"
