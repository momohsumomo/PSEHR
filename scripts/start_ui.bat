@echo off
setlocal
title Wundadi UI :3010
cd /d "%~dp0.."
chcp 65001 >nul
set "PATH=%CD%\frontend\node_modules\.bin;%CD%\.venv\Scripts;%PATH%"

cd frontend
if not exist "node_modules" (
  echo [UI] 第一次啟動，安裝前端套件 ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install 失敗
    pause
    exit /b 1
  )
)

echo.
echo [UI] http://127.0.0.1:3010  （接後端 :5000）
echo 關掉本視窗即停止畫面。
echo.
set "VITE_ENABLE_API=true"
set "VITE_API_BASE=/api"
call npm run dev -- --host 127.0.0.1 --port 3010 --strictPort
echo.
echo 畫面已結束。
pause
endlocal
