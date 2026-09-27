@echo off
REM Karim ERP - Smart Setup - one click, any PC.
REM Auto-detects installed PostgreSQL, fixes port and paths.
REM Usage: double click only. All messages come from Node.
setlocal EnableExtensions
title Karim ERP - Smart Setup
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :no_node

echo ============================================================
echo  Karim ERP - Smart Install v5.0
echo ============================================================
echo.

node scripts\smart-install.js %*
set RC=%errorlevel%

echo.
if %RC%==0 goto :ok
echo [ERROR] Setup failed with code %RC%.
echo For diagnosis run: node scripts\smart-install.js --doctor
goto :end

:ok
echo [OK] Setup complete. To run: RUN-KARIM.bat
goto :end

:no_node
echo [ERROR] Node.js not found. Install LTS from https://nodejs.org/ then retry.
set RC=1
goto :end

:end
pause
exit /b %RC%
