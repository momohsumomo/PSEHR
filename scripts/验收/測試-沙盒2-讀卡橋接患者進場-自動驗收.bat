@echo off
setlocal
title Sandbox2 Card Bridge Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   Card read-and-register API test
echo   POST /nhi/v1/card/read-and-register?mock=true
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_card_register.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
