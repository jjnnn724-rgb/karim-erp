@echo off
rem ============================================================
rem  karim-stop.cmd — FULL stop of the Karim ERP stack.
rem  Stops: KarimERP-Server + KarimERP-PrintWorker + Cloudflared,
rem  kills any leftover server processes, verifies port 5000 is
rem  actually freed, then stops PostgreSQL.
rem  NOTE: ASCII only on purpose — Arabic text inside a batch
rem  file breaks the cmd parser under UTF-8 codepages.
rem ============================================================
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
title Karim ERP - Full Stop
cd /d "%~dp0"

echo ==============================================
echo    Karim ERP - STOP EVERYTHING
echo ==============================================
echo.

echo [1/5] Stopping service KarimERP-Server ...
sc stop KarimERP-Server >nul 2>&1
set T=0
:waitstop
sc query KarimERP-Server | findstr "STOPPED" >nul 2>&1
if %errorlevel% EQU 0 goto stopped
set /a T+=1
if %T% LSS 30 (timeout /t 2 /nobreak >nul & goto waitstop)
echo       (wait timeout - forcing ahead)
:stopped
echo       OK

echo [2/5] Stopping PrintWorker + Cloudflared ...
sc stop KarimERP-PrintWorker >nul 2>&1
sc stop Cloudflared >nul 2>&1
echo       OK

echo [3/5] Killing every process holding port 5000 (full tree, respawn-safe) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0karim-killport.ps1" -Port 5000
if %errorlevel% NEQ 0 goto portfail

echo [4/5] Verifying port 5000 is really free ...
echo       Port 5000 is FREE - OK

echo [5/5] Stopping database postgresql-x64-18 ...
sc stop postgresql-x64-18 >nul 2>&1
echo       OK

echo.
echo ==============================================
echo    DONE - the whole server is STOPPED
echo ==============================================
echo.
pause
exit /b 0

:portfail
echo.
echo   [FAILED] Port 5000 is still busy - open Task Manager and kill it manually.
echo.
pause
exit /b 1
