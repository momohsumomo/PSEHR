@echo off
setlocal
title Sandbox2 NHI Condition Medication Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI condition + medication intake
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_condition_medication.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
