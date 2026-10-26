@echo off
rem ============================================================
rem  karim-start.cmd — FULL start of the Karim ERP stack.
rem  1) PostgreSQL  2) clean any stuck server on port 5000
rem  3) KarimERP-Server service + wait for real health 200
rem  4) PrintWorker + Cloudflared  5) open the app.
rem  NOTE: ASCII only on purpose — Arabic text inside a batch
rem  file breaks the cmd parser under UTF-8 codepages.
rem ============================================================
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
title Karim ERP - Full Start
cd /d "%~dp0"

echo ==============================================
echo    Karim ERP - START EVERYTHING
echo ==============================================
echo.

echo [1/5] Database postgresql-x64-18 ...
sc query postgresql-x64-18 | findstr "RUNNING" >nul 2>&1
if %errorlevel% EQU 0 goto dbok
sc start postgresql-x64-18 >nul 2>&1
set T=0
:waitdb
sc query postgresql-x64-18 | findstr "RUNNING" >nul 2>&1
if %errorlevel% EQU 0 goto dbok
set /a T+=1
if %T% LSS 30 (timeout /t 2 /nobreak >nul & goto waitdb)
echo.
echo   [FAILED] Database did not start.
echo.
pause
exit /b 1
:dbok
echo       OK - database is up

echo [2/5] Cleaning any stuck old server on port 5000 (full tree, respawn-safe) ...
sc stop KarimERP-Server >nul 2>&1
set T=0
:waitoldstop
sc query KarimERP-Server | findstr "STOPPED" >nul 2>&1
if %errorlevel% EQU 0 goto oldstopped
set /a T+=1
if %T% LSS 15 (timeout /t 2 /nobreak >nul & goto waitoldstop)
:oldstopped
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0karim-killport.ps1" -Port 5000
if %errorlevel% NEQ 0 goto portfail
timeout /t 2 /nobreak >nul
echo       OK - port 5000 is clean

echo [3/5] Starting KarimERP-Server service and waiting for real readiness (up to 90s) ...
sc start KarimERP-Server >nul 2>&1
set T=0
:wheath
curl -sk -o NUL -m 5 https://127.0.0.1:5000/api/health >nul 2>&1
if %errorlevel% EQU 0 goto healthy
set /a T+=1
if %T% LSS 30 (timeout /t 3 /nobreak >nul & goto wheath)
echo.
echo   [FAILED] Server did not come up - check the logs folder.
echo.
pause
exit /b 1
:healthy
echo       OK - server is UP and serving

echo [4/5] PrintWorker + Cloudflared tunnel ...
sc start KarimERP-PrintWorker >nul 2>&1
sc start Cloudflared >nul 2>&1
echo       OK

echo [5/5] Opening the app ...
start "" https://karimeg.online

echo.
echo ==============================================
echo    DONE - the whole server is RUNNING
echo    URL: https://karimeg.online
echo ==============================================
echo.
pause
exit /b 0

:portfail
echo.
echo   [FAILED] Port 5000 is still busy - see messages above.
echo.
pause
exit /b 1
