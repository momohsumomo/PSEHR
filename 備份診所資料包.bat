@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Builds one zip. Unzip it into a downloaded program folder.
echo Image files are not included. The clinic can stay open.
echo.
".venv\Scripts\python.exe" -u "scripts\export_clinic_pack.py"
echo.
pause
