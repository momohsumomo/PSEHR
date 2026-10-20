@echo off
cd /d "%~dp0"
start "讀卡" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "%~dp0讀卡.ps1"
exit /b
