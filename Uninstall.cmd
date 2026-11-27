@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Uninstall.ps1"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
