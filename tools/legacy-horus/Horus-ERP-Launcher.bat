@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Launcher
::  مطاعم الشرفة العالمي
::  ============================================================
::  Usage: Double-click or run from CMD
::  All output logged to %TEMP%\karim-launcher.log
:: ============================================================

cd /d "%~dp0"
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-launcher.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Launcher v4.7.0 started >> "%LOG%"
echo Working dir: %CD% >> "%LOG%"

title karim ERP v4.7.0 - Launcher

:: ============================================================
::  PRE-FLIGHT: Check environment before anything
:: ============================================================
call :preflight
if errorlevel 1 (
    echo.
    echo ============================================================
    echo   PRE-FLIGHT FAILED - See log: %LOG%
    echo ============================================================
    echo.
    pause
    goto menu
)

:menu
cls
echo.
echo ============================================================
echo   karim ERP v4.7.0 - Launcher
echo ============================================================
echo.
echo   [1] Setup      - Install (Node + PostgreSQL + DB)
echo   [2] Run        - Start the system
echo   [3] Stop       - Stop all services
echo   [4] Status     - System status
echo   [5] Build      - Build NSIS + Portable
echo   [6] Test       - Run tests
echo   [7] Backup     - Database backup
echo   [8] Restore    - Restore database
echo   [9] Reset DB   - Reset database
echo   [L] Log        - View log
echo   [0] Exit
echo.
:: choice.com: built-in Windows key menu (reliable, no text input needed)
choice /C:1234567890L /N /M "Enter choice (0-9, L): "

:: choice returns errorlevel = position in /C string
:: Position: 1=1, 2=2, ..., 9=9, 10=0, 11=L
if errorlevel 11 goto viewlog
if errorlevel 10 goto end
if errorlevel 9 goto resetdb
if errorlevel 8 goto restore
if errorlevel 7 goto backup
if errorlevel 6 goto test
if errorlevel 5 goto build
if errorlevel 4 goto status
if errorlevel 3 goto stop
if errorlevel 2 goto run
if errorlevel 1 goto setup

echo.
echo Invalid choice
timeout /t 2 >nul
goto menu

:: ============================================================
::  PRE-FLIGHT
:: ============================================================
:preflight
echo [PREFLIGHT] Checking environment... >> "%LOG%"

where node >nul 2>&1
if errorlevel 1 (
    echo [PREFLIGHT] FAIL: Node.js not found >> "%LOG%"
    echo.
    echo ERROR: Node.js 18+ is required.
    echo Download: https://nodejs.org/
    echo.
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo [PREFLIGHT] Node: !NODE_VER! >> "%LOG%"

where npm >nul 2>&1
if errorlevel 1 (
    echo [PREFLIGHT] FAIL: npm not found >> "%LOG%"
    echo.
    echo ERROR: npm is required. Reinstall Node.js.
    echo.
    exit /b 1
)
for /f "tokens=*" %%v in ('npm --version 2^>nul') do set "NPM_VER=%%v"
echo [PREFLIGHT] npm: !NPM_VER! >> "%LOG%"

echo test > .write-test 2>nul
if errorlevel 1 (
    echo [PREFLIGHT] FAIL: no write permission >> "%LOG%"
    echo.
    echo ERROR: Cannot write to %CD%
    echo Move project to a folder you own.
    echo.
    exit /b 1
)
del .write-test >nul 2>&1

:: Check disk using PowerShell
for /f "tokens=*" %%g in ('powershell -Command "(Get-PSDrive C).Free / 1GB" 2^>nul') do set "FREE_GB=%%g"
if !FREE_GB! LSS 2 (
    echo [PREFLIGHT] FAIL: not enough disk: !FREE_GB!GB >> "%LOG%"
    echo.
    echo ERROR: Need 2GB+ free. Only !FREE_GB!GB available.
    echo.
    exit /b 1
)
echo [PREFLIGHT] Disk: !FREE_GB!GB free >> "%LOG%"

echo [PREFLIGHT] All checks passed >> "%LOG%"
exit /b 0

:: ============================================================
::  Handlers
:: ============================================================

set "SCRIPTS_DIR=%~dp0windows-scripts"
if not exist "%SCRIPTS_DIR%\run-windows.bat" (
    echo.
    echo ERROR: windows-scripts\ folder is missing next to this launcher.
    echo Expected: %SCRIPTS_DIR%
    echo.
    pause
    goto menu
)

:setup
cls
echo.
echo ============================================================
echo   Setup - Installing karim ERP v4.7.0
echo ============================================================
echo.
call "%SCRIPTS_DIR%\setup-windows.bat"
goto menu

:run
cls
echo.
echo ============================================================
echo   Running karim ERP v4.7.0
echo ============================================================
echo.
call "%SCRIPTS_DIR%\run-windows.bat"
goto menu

:stop
cls
echo.
echo ============================================================
echo   Stopping karim ERP services
echo ============================================================
echo.
call "%SCRIPTS_DIR%\stop-windows.bat"
goto menu

:status
cls
echo.
echo ============================================================
echo   karim ERP Status
echo ============================================================
echo.
call "%SCRIPTS_DIR%\status-windows.bat"
goto menu

:build
cls
echo.
echo ============================================================
echo   Build - Creating Installer
echo ============================================================
echo.
call "%SCRIPTS_DIR%\build-windows.bat"
goto menu

:test
cls
echo.
echo ============================================================
echo   Tests
echo ============================================================
echo.
call "%SCRIPTS_DIR%\test-windows.bat"
goto menu

:backup
cls
echo.
echo ============================================================
echo   Backup
echo ============================================================
echo.
call "%SCRIPTS_DIR%\backup-windows.bat"
goto menu

:restore
cls
echo.
echo ============================================================
echo   Restore
echo ============================================================
echo.
call "%SCRIPTS_DIR%\restore-windows.bat"
goto menu

:resetdb
cls
echo.
echo ============================================================
echo   Reset Database
echo ============================================================
echo.
call "%SCRIPTS_DIR%\resetdb-windows.bat"
goto menu

:viewlog
notepad "%LOG%"
goto menu

:end
echo.
echo karim ERP v4.7.0 - Goodbye
echo.
exit /b 0
