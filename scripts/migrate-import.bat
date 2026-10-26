@echo off
REM ============================================================
REM Karim ERP - Smart Migration IMPORT - new machine - ADMIN ONLY
REM Usage: migrate-import.bat D:\KarimMigration\karim-erp-migration-XXXX [/keepwa]
REM   /keepwa  = reuse old WhatsApp session. DANGER: shut down the
REM              OLD machine first or both will fight -code 440-.
REM   default  = sessions quarantined, fresh QR pairing on new machine.
REM What it does:
REM   1. checks Admin + export folder + installs PostgreSQL 18 if missing
REM   2. restores files to a smart local install path (or KARIM_INSTALL_DIR)
REM   3. appends new hostname and IPs to ALLOWED_ORIGINS -smart host fix-
REM   4. npm ci, creates DB, restores dump, installs+starts services
REM   5. verifies health endpoint
REM ============================================================
setlocal EnableExtensions

net session >nul 2>&1
if errorlevel 1 goto :need_admin
if "%~1"=="" goto :usage
set "SRC=%~1"
set "KEEPWA=0"
if /i "%~2"=="/keepwa" set "KEEPWA=1"

if not exist "%SRC%\database.dump" goto :nosrc
if not exist "%SRC%\project\backend\server.js" goto :nosrc
if not exist "%SRC%\machine-profile.json" goto :nosrc

echo ============================================================
echo Karim ERP migration IMPORT
echo Source: %SRC%
if "%KEEPWA%"=="1" (
    echo WhatsApp: KEEP old session - SHUT DOWN OLD MACHINE FIRST.
) else (
    echo WhatsApp: FRESH pairing -old session quarantined, no fights-.
)
echo ============================================================

echo [1/7] Prerequisites...
where psql >nul 2>&1
if errorlevel 1 (
    echo       PostgreSQL missing - installing via winget...
    winget install --id PostgreSQL.PostgreSQL.18 --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :nopg
)
where node >nul 2>&1
if errorlevel 1 (
    echo       Node.js missing - installing via winget for npm ci...
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :nonode
)
echo       PostgreSQL + Node OK.

echo [2/7] Restoring files to identical paths...
if not defined KARIM_INSTALL_DIR set "KARIM_INSTALL_DIR=%ProgramFiles%\KarimERP"
set "PROJECT_DIR=%KARIM_INSTALL_DIR%"
echo       project path: %PROJECT_DIR%
mkdir "%PROJECT_DIR%" >nul 2>&1
robocopy "%SRC%\project" "%PROJECT_DIR%" /E /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
robocopy "%SRC%\HorusData" "C:\HorusData" /E /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
robocopy "%SRC%\KarimData" "C:\KarimData" /E /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
if exist "%SRC%\oracle" (
    robocopy "%SRC%\oracle" "C:\oracle" /E /NFL /NDL /NJH /NJS
    if errorlevel 8 goto :copyfail
)
echo       files OK.

echo [3/7] Smart host fix - hostname and IPs into ALLOWED_ORIGINS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env=Get-Content '%PROJECT_DIR%\.env' -Raw; $h=$env:COMPUTERNAME.ToLower(); $ips=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1'} | Select-Object -ExpandProperty IPAddress; $add=@(); $add+='https://'+$h+':5001'; $add+='https://'+$h+'.local:5001'; foreach($ip in $ips){$add+='https://'+$ip+':5001'}; $m=[regex]::Match($env,'(?m)^ALLOWED_ORIGINS=(.*)$'); if($m.Success){$cur=$m.Groups[1].Value.Trim(); $all=($cur.Split(',')+$add | ForEach-Object {$_.Trim()} | Where-Object {$_} | Select-Object -Unique) -join ','; $env=$env -replace '(?m)^ALLOWED_ORIGINS=.*$','ALLOWED_ORIGINS='+$all}; Set-Content '%PROJECT_DIR%\.env' $env -NoNewline; Write-Host ('      origins now: '+$all)"
echo       host fix OK.

echo [4/7] WhatsApp session policy...
if "%KEEPWA%"=="1" (
    echo       [WARN] keeping old session. OLD MACHINE MUST STAY OFF.
) else (
    if exist "C:\HorusData\whatsapp-sessions\creds.json" (
        mkdir "C:\HorusData\whatsapp-sessions-quarantine" >nul 2>&1
        move "C:\HorusData\whatsapp-sessions\creds.json" "C:\HorusData\whatsapp-sessions-quarantine\creds.json" >nul
        echo       old session quarantined - pair fresh QR after boot.
    ) else (
        echo       no session found - fresh pairing anyway.
    )
)

echo [5/7] Dependencies - npm ci, may take minutes...
cd /d "%PROJECT_DIR%"
call npm ci --no-audit --no-fund
if errorlevel 1 goto :npmfail
echo       dependencies OK.

echo [6/7] Database - create and restore...
set /p PG_SU_PW=Enter NEW machine postgres superuser password:
set "PGPASSWORD=%PG_SU_PW%"
psql -h 127.0.0.1 -U postgres -c "SELECT 1" >nul 2>&1
if errorlevel 1 goto :dbconn
psql -h 127.0.0.1 -U postgres -t -c "SELECT 1 FROM pg_database WHERE datname='karim_erp'" | findstr /r "1" >nul 2>&1
if errorlevel 1 (
    psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE karim_erp" >nul
    if errorlevel 1 goto :dbcreate
)
pg_restore -h 127.0.0.1 -U postgres -d karim_erp -c --if-exists "%SRC%\database.dump" >nul 2>&1
echo       database restored. Verify row counts in a moment via health.

echo [7/7] Services install + start + verify...
cd /d "%PROJECT_DIR%\windows-service"
call install-service.bat <nul
timeout /t 30 /nobreak >nul
for /l %%i in (1,1,8) do (
    curl -k -s https://127.0.0.1:5001/api/health | findstr /i "database" >nul 2>&1
    if not errorlevel 1 goto :healthy
    timeout /t 15 /nobreak >nul
)
goto :unhealthy

:healthy
echo.
echo ============================================================
echo IMPORT DONE - system live as on the old machine.
echo   https://%COMPUTERNAME%:5001/app/index.html
echo WhatsApp: open engine page - scan QR -fresh- or kept session resumes.
echo AFTER verifying: STOP services on the OLD machine to avoid fights.
echo ============================================================
set "PG_SU_PW="
exit /b 0

:need_admin
echo [ERROR] Run as Administrator.
exit /b 1
:usage
echo Usage: migrate-import.bat D:\KarimMigration\karim-erp-migration-XXXX [/keepwa]
exit /b 2
:nosrc
echo [ERROR] Export folder incomplete: %SRC%
exit /b 1
:nopg
echo [ERROR] PostgreSQL install failed. Install PostgreSQL 18 manually, then rerun.
exit /b 1
:nonode
echo [ERROR] Node.js install failed. Install Node.js LTS manually, then rerun.
exit /b 1
:copyfail
echo [ERROR] copy failed - check disk space and paths.
exit /b 1
:npmfail
echo [ERROR] npm ci failed - check internet, then rerun from step 5.
exit /b 1
:dbconn
echo [ERROR] cannot connect to PostgreSQL - check service and password.
set "PG_SU_PW="
exit /b 1
:dbcreate
echo [ERROR] CREATE DATABASE failed.
set "PG_SU_PW="
exit /b 1
:unhealthy
echo [WARN] services installed but health not OK after 2 min.
echo Check logs in project\logs and services.msc.
set "PG_SU_PW="
exit /b 3