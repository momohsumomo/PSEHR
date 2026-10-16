@echo off
setlocal
chcp 65001 >nul
title Import clinic Cloud SAM into NHI 6.0
cd /d "%~dp0.."
set "PYTHONPATH=%CD%"
set "PATH=%CD%\.venv\Scripts;%PATH%"

echo.
echo 6.0 does not use C:\NHI. This imports the .SAM via official CloudSam API.
echo Need: VPN route 10.x, console on https://localhost:5066, .SAM in project root.
echo.

python scripts\import_nhi_cloud_sam.py
echo.
pause
endlocal
