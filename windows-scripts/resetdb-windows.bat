@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Reset Database (DESTRUCTIVE, portable)
::  Delegates to node scripts/reset.js (interactive confirm).
::  ALL DATA WILL BE LOST. Make a backup first (option 7).
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-reset.log"
echo. > "%LOG%" 2>nul

title karim ERP - Reset Database (DANGER)

echo.
echo ============================================================
echo   WARNING - Reset Database
echo ============================================================
echo.
echo  This will DELETE ALL data. This CANNOT be undone.
echo  Take a backup first (Launcher option 7).
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not installed. & pause & exit /b 1 )

call node scripts/reset.js
set "RC=%errorlevel%"
echo [%time%] exit=%RC% >> "%LOG%"
echo.
if not "%RC%"=="0" ( echo Reset FAILED/aborted — log: %LOG% & pause )
exit /b %RC%
