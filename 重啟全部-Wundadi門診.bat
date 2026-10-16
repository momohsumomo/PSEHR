@echo off
setlocal
chcp 65001 >nul
title 重啟 北極星自主電子病歷系統
cd /d "%~dp0"

echo.
echo ========================================
echo   重啟 北極星自主電子病歷系統
echo   API  http://127.0.0.1:5000/docs
echo   UI   http://127.0.0.1:3010
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Missing .venv
  echo Run: python -m venv .venv
  echo Then: .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js first.
  pause
  exit /b 1
)

echo [1/4] Stop :5000 / :3010 ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_wundadi_ports.ps1"
if errorlevel 1 (
  echo [WARN] stop script reported an error; continuing anyway.
)

echo [2/4] Start API :5000
start "Wundadi-API-5000" cmd /k "%~dp0scripts\start_api.bat"

echo [3/4] Start UI :3010
start "Wundadi-UI-3010" cmd /k "%~dp0scripts\start_ui.bat"

echo [4/4] Wait until ready ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait_wundadi_ready.ps1"
if errorlevel 1 (
  echo [WARN] Not ready after ~60s. Check the two service windows for errors.
) else (
  echo       API and UI are ready.
)

echo.
echo Close windows "Wundadi-API-5000" and "Wundadi-UI-3010" to stop.
echo.
start "" "http://127.0.0.1:3010"
endlocal
exit /b 0
