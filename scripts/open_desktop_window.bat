@echo off
setlocal
chcp 65001 >nul

set "TARGET=%~1"
set "APP_URL=http://127.0.0.1:3010"
set "PROFILE=%LOCALAPPDATA%\PSEHR\window"
if /I "%TARGET%"=="kiosk" set "APP_URL=http://127.0.0.1:3010/kiosk/register"
if /I "%TARGET%"=="kiosk" set "PROFILE=%LOCALAPPDATA%\PSEHR\kiosk"
if /I "%TARGET%"=="intake" set "APP_URL=http://127.0.0.1:3010/kiosk/intake"
if /I "%TARGET%"=="intake" set "PROFILE=%LOCALAPPDATA%\PSEHR\intake"
set "EDGE="
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if not defined EDGE (
  echo [WARN] 找不到 Microsoft Edge，改開一般瀏覽器。
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
set "WIN=--start-maximized"
if /I "%TARGET%"=="intake" set "WIN=--window-size=960,640 --window-position=120,40"
start "北極星自主電子病歷系統" "%EDGE%" --app=%APP_URL% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-extensions %WIN%
endlocal
exit /b 0
