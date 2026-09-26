@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Stop Services
::  مطاعم الشرفة العالمي
::  ============================================================
::  Safe stop: kills ONLY our backend (by port) via
::  node scripts/stop.js — never blanket-kills node.exe
::  (that would murder the PrintWorker service + other apps).
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-stop.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Stop started >> "%LOG%"

title karim ERP - Stop Services

echo.
echo ============================================================
echo   Stopping karim ERP v4.7.0
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found — trying service stop only.
    goto services
)

:: ─── Graceful stop (port-based, safe) ───────────
call node scripts/stop.js
if errorlevel 1 (
    echo WARNING: graceful stop reported issues — see above.
)

:services
:: ─── Windows services (both old + new names, harmless if absent) ──
echo Stopping Windows services...
sc stop KarimERP-Server 2>nul
sc stop KarimERP-PrintWorker 2>nul
sc stop AlShorfaERP 2>nul
sc stop AlShorfaPrintWorker 2>nul
echo [%time%] Done >> "%LOG%"

:: ─── Summary ────────────────────────────────────
echo.
echo ============================================================
echo   All services stopped
echo ============================================================
echo.
echo Log: %LOG%
echo.
exit /b 0
