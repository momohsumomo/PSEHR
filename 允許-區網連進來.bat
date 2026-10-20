@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0scripts\host_service.ps1','-Action','firewall'"
echo.
echo If Windows asked and you allowed it, other PCs on this network can open the clinic page.
pause
