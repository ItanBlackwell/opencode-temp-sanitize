@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install.ps1" -PackageRoot "%~dp0."
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
