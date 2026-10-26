@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Offline Setup
::  مطاعم الشرفة العالمي — نظام إدارة المطاعم المتكامل
::  ============================================================
::  Portable: works from ANY folder — everything resolves
::  relative to this file (windows-scripts\.. = project root).
::  Delegates to node scripts/setup.js (single source of truth):
::    Node check → npm install → PostgreSQL → .env+secrets →
::    migrations → bcrypt → syntax check.
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-setup.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Setup v4.7.0 started >> "%LOG%"
echo [ROOT] %CD% >> "%LOG%"

title karim ERP v4.7.0 - Setup

echo.
echo ============================================================
echo   Setup - karim ERP v4.7.0
echo ============================================================
echo.

:: ─── Node.js ────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js 18+ is required: https://nodejs.org/
    echo [%time%] FAIL: node missing >> "%LOG%"
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo Node.js !NODE_VER! OK

:: ─── Full setup via Node (portable, same on every machine) ──
call node scripts/setup.js
set "RC=%errorlevel%"
echo [%time%] setup.js exited with code %RC% >> "%LOG%"

echo.
if not "%RC%"=="0" (
    echo Setup FAILED — see log: %LOG%
    echo.
    pause
    exit /b %RC%
)

:: ─── Optional: restore a backup (fresh machine migration) ──
set "HAS_BAK="
if exist "database\backups\*.dump" set "HAS_BAK=1"
if exist "database\backups\*.sql" set "HAS_BAK=1"
if defined HAS_BAK (
    echo.
    echo ============================================================
    echo   Found backup files in database\backups\
    echo ============================================================
    dir /b "database\backups\*.dump" "database\backups\*.sql" 2>nul
    echo.
    set "WANT_RESTORE="
    set /p WANT_RESTORE="Restore a backup now? Y/N: "
    if /i "!WANT_RESTORE!"=="Y" (
        set "REST_FILE="
        set /p REST_FILE="Enter backup filename: "
        if defined REST_FILE (
            if not exist "!REST_FILE!" (
                if exist "database\backups\!REST_FILE!" set "REST_FILE=database\backups\!REST_FILE!"
            )
            if exist "!REST_FILE!" (
                call node database/scripts/restore.js "!REST_FILE!" --yes
            ) else (
                echo File not found — skipping restore. Use menu option [8] later.
            )
        )
    )
)

echo ============================================================
echo   Setup complete. Start with option [2] Run.
echo ============================================================
echo.
exit /b 0
