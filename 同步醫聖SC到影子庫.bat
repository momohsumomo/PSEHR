@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Sync Yisheng Z:\SC into shadow.db
echo Method: field-map + bulk INSERT (not one-by-one)
echo 1) LEAN index tables from SC
echo 2) Bulk materialize FHIR cache from index (same clinical result)
echo 3) Refresh clinic drug catalog (MAKING / ALIAS_NO)
echo.
echo Close Wundadi API first if running.
echo.
set PYTHONUNBUFFERED=1
".venv\Scripts\python.exe" -u "scripts\import_yisheng_lean.py" --sc-root "Z:\SC" --replace --limit-visits 0
if errorlevel 1 goto :end
".venv\Scripts\python.exe" -u "scripts\bulk_materialize_fhir_from_index.py"
if errorlevel 1 goto :end
".venv\Scripts\python.exe" -u "scripts\export_yisheng_clinic_catalog.py" --sc-root "Z:\SC"
:end
echo.
pause
