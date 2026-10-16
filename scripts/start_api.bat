@echo off
setlocal
title Wundadi API :5000
cd /d "%~dp0.."
chcp 65001 >nul
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] 找不到 .venv
  echo 請先在專案根目錄執行: python -m venv .venv
  echo 然後: .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)

echo [API] 初始化影子庫 ...
python scripts\init_shadow_db.py
if errorlevel 1 (
  echo [ERROR] init_shadow_db 失敗
  pause
  exit /b 1
)

echo.
echo [API] http://127.0.0.1:5000/docs
echo 關掉本視窗即停止後端。
echo.
python -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 5000
echo.
echo 後端已結束。
pause
endlocal
