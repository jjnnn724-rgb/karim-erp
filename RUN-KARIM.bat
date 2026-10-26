@echo off
REM Karim ERP - Run. Auto-detects DB and auto-fixes port.
setlocal EnableExtensions
title Karim ERP - Running
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

node scripts\serve.js %*
set RC=%errorlevel%
echo.
echo System stopped with code %RC%.
goto :end

:no_node
echo [ERROR] Node.js not found - https://nodejs.org/
set RC=1
goto :end

:end
pause
exit /b %RC%
