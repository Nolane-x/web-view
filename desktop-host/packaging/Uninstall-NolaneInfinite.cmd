@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-NolaneInfinite.ps1" %*
if errorlevel 1 (
  echo.
  echo Nolane Infinite removal did not complete. Review the error above.
  pause
)
endlocal
