@echo off
setlocal
title Open this Wundadi project in Cursor
cd /d "%~dp0"

echo.
echo ========================================
echo   Open this project folder in Cursor
echo   Ask here for main product OR seasonal
echo   NHI project help (attach the circular).
echo ========================================
echo.
echo Guide: docs\診所端-用Cursor處理時令專案.md
echo.

where cursor >nul 2>&1
if errorlevel 1 (
  echo [ERROR] "cursor" command not found.
  echo Install Cursor from https://cursor.com
  echo then re-run this bat. Opening download page...
  start "" "https://cursor.com"
  pause
  exit /b 1
)

echo Launching: cursor "%CD%"
start "" cursor "%CD%"
exit /b 0
