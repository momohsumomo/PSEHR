@echo off
cd /d "%~dp0"
title Fix NHI cshis6 TCP 5066
echo Freeing TCP 5066 then starting NHI console 6.0 ...
echo Click YES if Windows asks for Administrator.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\fix_nhi_cshis6_port5066.ps1"
echo.
echo Log: data\nhi-cshis6-port-fix.log
pause
