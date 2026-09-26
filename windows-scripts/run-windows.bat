@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Run System
::  مطاعم الشرفة العالمي
::  ============================================================
::  Portable: works from ANY folder — everything resolves
::  relative to this file (windows-scripts\.. = project root).
:: ============================================================

:: Project root (parent of windows-scripts) — works on any machine/path
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-run.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Run v4.7.0 started >> "%LOG%"
echo [ROOT] %CD% >> "%LOG%"

title karim ERP v4.7.0 - Running

echo.
echo ============================================================
echo   karim ERP v4.7.0 - Starting
echo ============================================================
echo.

:: ─── Node.js ────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Run Setup - option 1.
    echo [%time%] FAIL: node missing >> "%LOG%"
    echo.
    pause
    exit /b 1
)

:: ─── Dependencies ───────────────────────────────
if not exist node_modules (
    echo Dependencies missing — installing one time...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
)

:: ─── Port from .env (default 5000) ──────────────
set "PORT=5000"
if exist .env (
    for /f "tokens=2 delims==" %%a in ('findstr "^PORT=" .env 2^>nul') do set "PORT=%%a"
)
echo Server port: !PORT!
echo.

:: ─── Takeover: stop ANY old copy on this port, run MINE ──
:: NOTE: goto-style, no paren blocks (batch-safe).
set "BUSY_PID="
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":%PORT% "') do set "BUSY_PID=%%p"
if not defined BUSY_PID goto start_server
echo.
echo WARNING: port !PORT! is busy - PID !BUSY_PID! - another copy may be running.
set "TAKE="
if /i "%KARIM_TAKEOVER%"=="Y" goto takeover_yes
set /p TAKE="Stop it and run MY copy instead? [Y/N]: "
if /i "!TAKE:~0,1!"=="Y" goto takeover_yes
if /i "!TAKE:~0,1!"=="y" goto takeover_yes
goto takeover_abort
:takeover_yes
echo Stopping old copy...
call node scripts/stop.js >nul 2>&1
taskkill /F /PID !BUSY_PID! >nul 2>&1
sc stop KarimERP-Server >nul 2>&1
sc stop AlShorfaERP >nul 2>&1
timeout /t 3 /nobreak >nul
set "BUSY_PID="
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":%PORT% "') do set "BUSY_PID=%%p"
if defined BUSY_PID goto takeover_stuck
echo Old copy stopped. Starting mine...
echo.
goto start_server
:takeover_abort
echo Aborted - old copy left running.
exit /b 0
:takeover_stuck
echo ERROR: port !PORT! still busy - PID !BUSY_PID! - maybe a service, run as admin.
echo [%time%] FAIL: port busy >> "%LOG%"
echo.
pause
exit /b 1
:start_server

:: ─── Start (serve.js handles PG + migrations + health) ──
echo Starting... (press Ctrl+C to stop)
echo.
call node scripts/serve.js
set "RC=%errorlevel%"
echo [%time%] serve.js exited with code %RC% >> "%LOG%"
echo.
if not "%RC%"=="0" (
    echo Server stopped with errors — see log: %LOG%
    echo.
    pause
)
exit /b %RC%
