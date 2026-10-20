@echo off
cd /d "%~dp0\..\.."
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy.MM.dd"') do set TAG=program-%%i
echo Creating %TAG%
gh release create %TAG% --target main --title "program %TAG%" --notes "Program update. Clinic data stays on the PC. New fields are filled in when the service starts."
if errorlevel 1 (
  echo Release was not created.
)
pause
