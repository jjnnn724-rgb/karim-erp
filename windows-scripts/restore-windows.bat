@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Database Restore (portable)
::  Delegates to node database/scripts/restore.js (with --yes
::  after explicit confirmation here). Lists project backups.
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-restore.log"
echo. > "%LOG%" 2>nul

title karim ERP - Restore

echo.
echo ============================================================
echo   Restore - karim ERP v4.7.0
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not installed. & pause & exit /b 1 )
if not exist .env ( echo ERROR: .env not found. Run Setup first. & pause & exit /b 1 )

echo Available backups (database\backups\):
if exist "database\backups" ( dir /b "database\backups\*.dump" "database\backups\*.sql" 2>nul ) else ( echo   (none yet) )
echo.
set "BACKUP_FILE="
set /p BACKUP_FILE="Enter backup filename (or full path): "
if not defined BACKUP_FILE ( echo Aborted. & exit /b 0 )
:: allow bare filename from project backups dir
if not exist "!BACKUP_FILE!" (
    if exist "database\backups\!BACKUP_FILE!" set "BACKUP_FILE=database\backups\!BACKUP_FILE!"
)
if not exist "!BACKUP_FILE!" (
    echo ERROR: File not found: !BACKUP_FILE!
    echo.
    pause
    exit /b 1
)

echo.
echo WARNING: this OVERWRITES the current database.
set /p CONFIRM="Type YES to continue: "
if not "!CONFIRM!"=="YES" ( echo Aborted. & exit /b 0 )

call node database/scripts/restore.js "!BACKUP_FILE!" --yes
set "RC=%errorlevel%"
echo [%time%] exit=%RC% >> "%LOG%"
echo.
if not "%RC%"=="0" ( echo Restore FAILED — log: %LOG% & pause )
exit /b %RC%
