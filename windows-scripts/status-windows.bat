@echo off
setlocal EnableDelayedExpansion EnableExtensions

:: ============================================================
::  karim ERP v4.7.0 — Status Check
::  Portable: resolves project root from this file location.
::  NOTE: single-branch IFs only (no ELSE blocks — fragile in batch).
:: ============================================================

:: Project root (parent of windows-scripts)
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

title karim ERP - Status

echo.
echo ============================================================
echo   karim ERP v4.7.0 - Status  [%CD%]
echo ============================================================
echo.

:: ─── Node.js ────────────────────────────────────
set "NODE_VER=NOT INSTALLED --X--"
where node >nul 2>&1
if not errorlevel 1 for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v OK"
echo [Node]      !NODE_VER!

:: ─── Dependencies ───────────────────────────────
set "NM=MISSING --X--"
if exist node_modules set "NM=EXISTS OK"
echo [node_modules] !NM!

:: ─── PostgreSQL client (PATH, then common install dirs) ──
set "PG_VER=NOT FOUND --X--"
where psql >nul 2>&1
if not errorlevel 1 for /f "tokens=*" %%v in ('psql --version 2^>nul') do set "PG_VER=%%v OK"
if "!PG_VER!"=="NOT FOUND --X--" (
    for /d %%d in ("C:\Program Files\PostgreSQL\*") do (
        if exist "%%d\bin\psql.exe" set "PG_VER=found at %%d OK"
    )
)
echo [PostgreSQL] !PG_VER!

:: ─── .env ───────────────────────────────────────
set "ENV=EXISTS OK"
if not exist .env set "ENV=MISSING --X-- (run Setup)"
echo [.env]       !ENV!

:: ─── Disk (project drive, not hardcoded C:) ─────
set "FREE_GB=?"
for /f "tokens=*" %%g in ('powershell -NoProfile -Command "(Get-PSDrive '%CD:~0,1%').Free / 1GB" 2^>nul') do set "FREE_GB=%%g"
echo [Disk %CD:~0,1%:]      !FREE_GB!GB free

:: ─── Backend (port from .env, default 5000) ─────
set "PORT=5000"
if exist .env for /f "tokens=2 delims==" %%a in ('findstr "^PORT=" .env 2^>nul') do set "PORT=%%a"
set "BE=NOT RUNNING --X-- (port !PORT!)"
netstat -an 2>nul | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
if not errorlevel 1 set "BE=RUNNING OK (port !PORT!)"
echo [Backend]    !BE!

:: ─── Database reachability ──────────────────────
set "DB_PORT=5432"
if exist .env for /f "tokens=2 delims==" %%a in ('findstr "^DB_PORT=" .env 2^>nul') do set "DB_PORT=%%a"
set "DB=NOT LISTENING --X-- (port !DB_PORT!)"
netstat -an 2>nul | findstr "LISTENING" | findstr ":%DB_PORT% " >nul 2>&1
if not errorlevel 1 set "DB=LISTENING OK (port !DB_PORT!)"
echo [Database]   !DB!

:: ─── Windows services ───────────────────────────
set "S1=STOPPED"
sc query KarimERP-Server 2>nul | findstr "RUNNING" >nul 2>&1
if not errorlevel 1 set "S1=RUNNING OK"
echo [Service]    KarimERP-Server !S1!
set "S2=STOPPED"
sc query KarimERP-PrintWorker 2>nul | findstr "RUNNING" >nul 2>&1
if not errorlevel 1 set "S2=RUNNING OK"
echo [PrintWorker] !S2!

echo.
echo ============================================================
echo   Status check complete
echo ============================================================
echo.
exit /b 0
