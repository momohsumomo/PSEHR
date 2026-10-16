@echo off
setlocal
title Sandbox2 Full Clinic Day Flow

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   Full clinic day flow (E2E)
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_clinic_flow.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
