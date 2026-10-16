@echo off
setlocal
title Sandbox2 Outpatient Loop Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   Outpatient loop API test
echo   workspace + previsit + previous Rx
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_outpatient_loop.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
