@echo off
setlocal
chcp 65001 >nul
title Diagnose NHI card reader 6.0
cd /d "%~dp0"
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo 6.0 card diagnose — SAM / health card / HPC. Does not take a sequence number.
echo Official console: https://localhost:5066
echo IC read now scans every PC/SC reader (any brand / slot count).
echo For the full init SOP: python utils\nhi_reader.py sop
echo.

python utils\nhi_reader.py diagnose
echo.
pause
endlocal
