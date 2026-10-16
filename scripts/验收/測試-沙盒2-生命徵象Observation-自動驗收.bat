@echo off
setlocal
title Sandbox2 NHI Observation Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI Observation register test
echo   POST /nhi/v1/observation/register
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_observation_intake.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
