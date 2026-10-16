@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
setlocal EnableDelayedExpansion

echo ============================================================
echo   醫聖備份 → Wundadi 影子庫（合併匯入／可補新）
echo ============================================================
echo.
echo 說明：
echo   - 備份檔放在 BkZip\BKxxxx.exe（醫聖自解壓縮／ZIP）
echo   - 病患主檔 USER.Dat 全匯；門診預設最近 10000 筆（可改）
echo   - 同一支工具可重跑：新備份會 INSERT OR REPLACE 合併補上
echo   - 現況若病患變少，多半是 shadow.db 被重建，不是備份不見
echo.

".venv\Scripts\python.exe" "scripts\import_yisheng_data.py" --list-backups
if errorlevel 1 (
  echo.
  echo 請先把 BKxxxx.exe 放到專案 BkZip\ 再執行本工具。
  pause
  exit /b 1
)

echo.
set /p CHOICE=請輸入編號（直接 Enter=最舊一筆，適合先灌舊資料）: 
set /p LIMIT=門診筆數上限（Enter=10000，輸入 0=全部門診）: 

if "%LIMIT%"=="" set LIMIT=10000

".venv\Scripts\python.exe" -c "from pathlib import Path; import sys; root=Path(r'%CD%')/'BkZip'; files=sorted([p for p in root.iterdir() if p.is_file() and p.suffix.lower() in {'.exe','.zip'} and p.name.upper().startswith('BK')], key=lambda p:(p.stat().st_mtime,p.name)); choice=r'''%CHOICE%'''.strip(); idx=0 if not choice else int(choice)-1; sys.exit(0 if 0<=idx<len(files) else 2); print(files[idx])" > "%TEMP%\wundadi_bk_pick.txt" 2>nul

".venv\Scripts\python.exe" -c "from pathlib import Path; root=Path(r'%CD%')/'BkZip'; files=sorted([p for p in root.iterdir() if p.is_file() and p.suffix.lower() in {'.exe','.zip'} and p.name.upper().startswith('BK')], key=lambda p:(p.stat().st_mtime,p.name)); choice=r'''%CHOICE%'''.strip(); idx=0 if not choice else int(choice)-1; print(files[idx] if 0<=idx<len(files) else '')" > "%TEMP%\wundadi_bk_pick.txt"

set /p BACKUP_PATH=<"%TEMP%\wundadi_bk_pick.txt"
if "%BACKUP_PATH%"=="" (
  echo 編號無效。
  pause
  exit /b 1
)

echo.
echo 即將匯入: %BACKUP_PATH%
echo 門診上限: %LIMIT%
echo.
pause

".venv\Scripts\python.exe" "scripts\import_yisheng_data.py" --backup-exe "%BACKUP_PATH%" --limit-visits %LIMIT%
set ERR=%ERRORLEVEL%

echo.
if %ERR% equ 0 (
  echo [成功] 已合併進 data\shadow.db
  echo 之後有更新的 BK 檔：丟進 BkZip\ 再跑本 bat 選較新的即可補新。
) else (
  echo [失敗] 請往上看錯誤訊息。
)
pause
exit /b %ERR%
