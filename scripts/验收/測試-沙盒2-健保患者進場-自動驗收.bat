@echo off
setlocal
title Sandbox2 NHI Patient Intake Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI patient register API test
echo   POST /nhi/v1/patient/register
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_patient_intake.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
