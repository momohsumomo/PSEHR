@echo off
cd /d "%~dp0"
set "SCRIPT="
for %%F in (*.ps1) do (
  set "SCRIPT=%%~fF"
  goto run
)
echo This folder has no card script.
pause
exit /b 1
:run
start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%SCRIPT%"
exit /b 0
