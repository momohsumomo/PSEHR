@echo off
for %%F in ("%~dp0*.ps1") do (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%%F"
  exit /b 0
)
echo missing script
pause
