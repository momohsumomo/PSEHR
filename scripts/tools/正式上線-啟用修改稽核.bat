@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo.
echo === 正式上線：啟用修改稽核（責任機制）===
echo 預設會清空「上線前」測試／匯入留下的稽核噪音。
echo 只查狀態可加參數：--status
echo.
".venv\Scripts\python.exe" scripts\enable_audit_go_live.py %*
if errorlevel 1 pause
pause
