@echo off
chcp 65001 >nul
cd /d "%~dp0"
call "scripts\tools\匯入醫聖備份-選檔合併.bat"
