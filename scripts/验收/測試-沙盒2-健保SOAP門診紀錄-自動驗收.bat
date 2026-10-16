@echo off
setlocal
title Sandbox2 NHI SOAP Test

cd /d "%~dp0\..\.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   NHI SOAP register API test
echo   POST /nhi/v1/soap/register
echo ========================================
echo.

python scripts\init_shadow_db.py
python scripts\test_nhi_soap_intake.py
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
