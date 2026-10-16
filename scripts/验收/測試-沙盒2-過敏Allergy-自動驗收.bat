@echo off
setlocal
title Sandbox2 NHI Allergy Intake Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI allergy register API test
echo   POST /nhi/v1/allergy/register
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_allergy_intake.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
