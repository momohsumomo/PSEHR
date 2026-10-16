@echo off
chcp 65001 >nul
cd /d "%~dp0\..\.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" scripts\fetch_drug_pack.py
) else (
  python scripts\fetch_drug_pack.py
)
pause
