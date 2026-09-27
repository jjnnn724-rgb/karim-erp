@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-usb-export.ps1" %*
if errorlevel 1 (echo Export failed.& pause& exit /b 1)
echo Export complete.
pause