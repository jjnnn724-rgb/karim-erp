@echo off
REM ============================================================
REM Karim ERP - Daily PostgreSQL Backup (STEEL layer: data safety)
REM - Full pg_dump (custom format) + rotation (keep 14 days)
REM - Run via Task Scheduler daily, e.g. 03:00
REM   schtasks /create /tn "KarimERP-Backup" /tr "\"<this file>\"" /sc daily /st 03:00 /ru SYSTEM
REM ============================================================
setlocal EnableDelayedExpansion

set "PG_BIN=C:\Program Files\PostgreSQL\18\bin"
set "BACKUP_DIR=C:\KarimData\db-backups"
set "KEEP_DAYS=14"
set "LOG=%BACKUP_DIR%\backup.log"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%" >nul 2>&1

for /f "tokens=2 delims==" %%a in ('findstr /B "DB_NAME=" "C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp\.env"') do set "DB_NAME=%%a"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_USER=" "C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp\.env"') do set "DB_USER=%%a"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_PASSWORD=" "C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp\.env"') do set "PGPASSWORD=%%a"
set "DB_NAME=%DB_NAME: =%"
set "DB_USER=%DB_USER: =%"

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%t"
set "FILE=%BACKUP_DIR%\karim_erp_%STAMP%.dump"

echo [%date% %time%] backup start: %FILE% >> "%LOG%"
"%PG_BIN%\pg_dump.exe" -h 127.0.0.1 -U %DB_USER% -F c -Z 6 -f "%FILE%" %DB_NAME% >> "%LOG%" 2>&1

if not exist "%FILE%" (
    echo [%date% %time%] BACKUP FAILED - no file >> "%LOG%"
    exit /b 1
)
for %%f in ("%FILE%") do set "SIZE=%%~zf"
if %SIZE% LSS 100000 (
    echo [%date% %time%] BACKUP SUSPICIOUS - size %SIZE% bytes - %FILE% >> "%LOG%"
    exit /b 1
)

REM rotation: delete dumps older than KEEP_DAYS
forfiles /p "%BACKUP_DIR%" /m *.dump /d -%KEEP_DAYS% /c "cmd /c del @path" >nul 2>&1

echo [%date% %time%] backup OK size=%SIZE% %FILE% >> "%LOG%"
echo OK %FILE% (%SIZE% bytes)
endlocal