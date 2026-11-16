@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnose-NolaneInfinite.ps1"
if errorlevel 1 (
  echo.
  echo Diagnostics failed. Review the error above.
  pause
)
endlocal
