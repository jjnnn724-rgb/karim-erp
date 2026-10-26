@echo off
REM ============================================================
REM  KARIMERP — karim ERP one-click installer & service runner
REM  Double-click: requests admin, installs everything, runs as
REM  Windows services that start with the computer.
REM ============================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
node scripts\karim-erp.js %*
echo.
pause
