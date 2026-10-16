@echo off
setlocal
title Wundadi Hub - NHI drug pack publisher
cd /d "%~dp0\.."
set "PATH=%CD%\.venv\Scripts;%PATH%"
set "PYTHONPATH=%CD%"

echo.
echo ========================================
echo   Hub: fetch NHI open data -^> Pack
echo   Publish dir: data\hub_packages
echo   Events: data\hub_workspace\events
echo ========================================
echo.
echo Tip: set HUB_FETCH_LIMIT=3000 for a quick test
echo      set HUB_LLM_REQUIRED_ON_MATERIAL=0 for first bootstrap without LLM
echo      set OPENAI_API_KEY=... for LLM verify on material diffs
echo.

python -m hub.run %*
echo.
echo Exit code %ERRORLEVEL%  (0=ok/skip, 2=event blocked, 1=fail)
pause
