@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "TARGET=%~1"
set "APP_URL=http://127.0.0.1:3010"
set "PROFILE=%LOCALAPPDATA%\PSEHR\window"
set "WIN=--start-maximized"
if /I "%TARGET%"=="kiosk" (
  set "APP_URL=http://127.0.0.1:3010/kiosk/register"
  set "PROFILE=%LOCALAPPDATA%\PSEHR\kiosk"
)
if /I "%TARGET%"=="intake" (
  set "APP_URL=http://127.0.0.1:3010/kiosk/intake"
  set "PROFILE=%LOCALAPPDATA%\PSEHR\intake"
  set "WIN=--start-maximized"
)

set "PF86=%ProgramFiles(x86)%"
set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%PF86%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Edge was not found.
  start "" "%APP_URL%"
  exit /b 0
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
set "LOGDIR=%~dp0..\data\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

>>"%LOGDIR%\window.log" echo open %TARGET% %APP_URL%
start "" "%EDGE%" --new-window --app=%APP_URL% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-extensions %WIN%
if errorlevel 1 (
  echo Failed to open %APP_URL%> "%LOGDIR%\window.log"
  exit /b 1
)
exit /b 0
