@echo off
net session >nul 2>&1
if errorlevel 1 (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo .NET Runtime 6 x86
start /wait "" "%~dp0dotnet-runtime-6-win-x86.exe" /install /quiet /norestart
echo ASP.NET Core Runtime 6 x86
start /wait "" "%~dp0aspnetcore-runtime-6-win-x86.exe" /install /quiet /norestart
echo card reader 6.0
start /wait msiexec.exe /i "%~dp0ciem6001s03.msi" /quiet /norestart
echo done
