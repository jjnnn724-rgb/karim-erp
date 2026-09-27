@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DOCKER-USB-IMPORT.ps1" %*
if errorlevel 1 (echo Import failed.& pause& exit /b 1)
echo Import complete. Open http://localhost:5000/app/index.html
pause