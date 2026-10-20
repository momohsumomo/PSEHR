@echo off
for %%F in ("%~dp0*.exe") do (
  start "" "%%F"
  exit /b 0
)
