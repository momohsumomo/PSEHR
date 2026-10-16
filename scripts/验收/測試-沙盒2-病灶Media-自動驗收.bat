@echo off
setlocal
title Sandbox2 NHI Media Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI lesion Media API test
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_media_intake.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
