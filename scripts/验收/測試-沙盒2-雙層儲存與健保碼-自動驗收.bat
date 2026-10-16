@echo off
setlocal
title Sandbox2 Auto Acceptance Test

cd /d "%~dp0\..\.."

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing .venv
    pause
    exit /b 1
)

set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo ========================================
echo   Sandbox2 auto test
echo   dual-layer + NHI codes
echo   no uvicorn / no browser needed
echo ========================================
echo.

python scripts\init_shadow_db.py
if errorlevel 1 (
    echo [ERROR] init_shadow_db failed
    pause
    exit /b 1
)

echo.
python scripts\test_sandbox2_acceptance.py
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo You can skip manual Swagger checks for this round.
) else (
    echo Fix errors above, or paste output to Cursor.
)
pause
exit /b %RC%
