@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
echo ============================================================
echo   一鍵匯入醫聖備份（預設最舊 BkZip\BK*.exe，合併進影子庫）
echo ============================================================
echo.
echo 進階選檔請用：scripts\tools\匯入醫聖備份-選檔合併.bat
echo.

set BACKUP_PATH=%~1
set LIMIT=%~2
if "%LIMIT%"=="" set LIMIT=10000

if "%BACKUP_PATH%"=="" (
  ".venv\Scripts\python.exe" -c "from pathlib import Path; root=Path('BkZip'); files=sorted([p for p in root.iterdir() if p.is_file() and p.suffix.lower() in {'.exe','.zip'} and p.name.upper().startswith('BK')], key=lambda p:(p.stat().st_mtime,p.name)); print(files[0] if files else '')" > "%TEMP%\wundadi_bk_default.txt"
  set /p BACKUP_PATH=<"%TEMP%\wundadi_bk_default.txt"
)

if "%BACKUP_PATH%"=="" (
  echo 找不到 BkZip\BK*.exe。請先放入備份檔。
  pause
  exit /b 1
)

echo Backup: %BACKUP_PATH%
echo Limit visits: %LIMIT%
echo.

".venv\Scripts\python.exe" "scripts\import_yisheng_data.py" --backup-exe "%BACKUP_PATH%" --limit-visits %LIMIT%
if %ERRORLEVEL% equ 0 (
  echo.
  echo [SUCCESS] 合併完成。補新：再跑一次並指定較新的 BKxxxx.exe
) else (
  echo.
  echo [ERROR] Import failed.
)
pause
