@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title 北極星自主電子病歷系統
cd /d "%~dp0"

echo.
echo ========================================
echo   北極星自主電子病歷系統
echo   後端  http://127.0.0.1:5000/docs
echo   畫面  http://127.0.0.1:3010
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] 尚未建立 Python 環境。
  echo 請先執行:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 找不到 node。請先安裝 Node.js 再雙擊本檔。
  pause
  exit /b 1
)

echo [1/3] 後端 :5000
curl.exe -s -o nul -m 2 http://127.0.0.1:5000/health >nul 2>&1
if errorlevel 1 (
  start "北極星-API-5000" cmd /k "%~dp0scripts\start_api.bat"
) else (
  echo       已在跑，沿用現有後端。
)

echo [2/3] 畫面 :3010
curl.exe -s -o nul -m 2 http://127.0.0.1:3010 >nul 2>&1
if errorlevel 1 (
  start "北極星-UI-3010" cmd /k "%~dp0scripts\start_ui.bat"
) else (
  echo       已在跑，沿用現有畫面。
)

echo [3/3] 等待服務就緒 ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false; 1..45 | ForEach-Object { $a=$false; $u=$false; try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/health -TimeoutSec 1).StatusCode -eq 200) { $a=$true } } catch {} ; try { if ((Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3010 -TimeoutSec 1).StatusCode -eq 200) { $u=$true } } catch {} ; if ($a -and $u) { Write-Output READY; exit 0 } ; Start-Sleep -Seconds 1 } ; Write-Output WAIT; exit 1"

if errorlevel 1 (
  echo [WARN] 等了約 45 秒仍未全開，仍會打開瀏覽器。
  echo       請看「北極星-API-5000」「北極星-UI-3010」兩個視窗有沒有紅字。
) else (
  echo       後端與畫面都已就緒。
)

echo.
echo 關掉那兩個服務視窗 = 停止門診。
echo 讀卡機埠若被佔用: 雙擊 fix-nhi-cshis6-port-5066.bat
echo 問問題: 雙擊 開啟-用Cursor問本專案.bat
echo.
start "" "http://127.0.0.1:3010"
endlocal
exit /b 0
