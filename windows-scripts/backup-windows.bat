@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Database Backup (portable)
::  Backups go to database\backups\ (inside project — travels
::  with it) + optional copy to %TEMP%.
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

set "LOG=%TEMP%\karim-backup.log"
echo. > "%LOG%" 2>nul
echo [%date% %time%] Backup started >> "%LOG%"

title karim ERP - Backup

echo.
echo ============================================================
echo   Backup - karim ERP v4.7.0
echo ============================================================
echo.

where pg_dump >nul 2>&1
if errorlevel 1 (
    echo ERROR: pg_dump not found. Is PostgreSQL installed?
    echo.
    pause
    exit /b 1
)

if not exist .env (
    echo ERROR: .env not found. Run Setup first.
    echo.
    pause
    exit /b 1
)

:: ─── Credentials from .env (DB_PASSWORD is the real key) ──
for /f "tokens=2 delims==" %%a in ('findstr "^DB_USER=" .env 2^>nul') do set "DB_USER=%%a"
for /f "tokens=2 delims==" %%a in ('findstr "^DB_PASSWORD=" .env 2^>nul') do set "DB_PASS=%%a"
for /f "tokens=2 delims==" %%a in ('findstr "^DB_PORT=" .env 2^>nul') do set "DB_PORT=%%a"
for /f "tokens=2 delims==" %%a in ('findstr "^DB_NAME=" .env 2^>nul') do set "DB_NAME=%%a"
if not defined DB_USER set "DB_USER=postgres"
if not defined DB_PORT set "DB_PORT=5432"
if not defined DB_NAME set "DB_NAME=karim_erp"

:: ─── Destination: inside project (portable) ─────
set "BACKUP_DIR=%CD%\database\backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%" 2>nul
if not exist "%BACKUP_DIR%" set "BACKUP_DIR=%TEMP%\karim-backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%" 2>nul

:: Locale-independent timestamp via PowerShell
for /f "tokens=*" %%t in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'" 2^>nul') do set "TS=%%t"
if not defined TS set "TS=manual"
set "FILENAME=karim-backup-%TS%.dump"

echo Backup dir : %BACKUP_DIR%
echo File       : %FILENAME%
echo DB         : %DB_NAME% @ localhost:%DB_PORT%
echo.

set "PGPASSWORD=%DB_PASS%"
pg_dump -U %DB_USER% -h localhost -p %DB_PORT% -d %DB_NAME% -F c -f "%BACKUP_DIR%\%FILENAME%"
if errorlevel 1 (
    echo ERROR: Backup failed!
    echo [%time%] FAIL >> "%LOG%"
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Backup complete
echo   %BACKUP_DIR%\%FILENAME%
echo ============================================================
echo.
echo [%time%] OK: %FILENAME% >> "%LOG%"
exit /b 0
