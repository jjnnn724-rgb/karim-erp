@echo off
REM ============================================================
REM Karim ERP - Smart Migration EXPORT - old machine
REM Usage: migrate-export.bat D:\KarimMigration
REM Copies: project code -no node_modules/logs-, HorusData, KarimData,
REM         Oracle client, DB dump + machine-profile.json
REM No admin needed. Then move the USB/disk to the new machine and
REM run migrate-import.bat there as Administrator.
REM ============================================================
setlocal EnableExtensions

if "%~1"=="" goto :usage
set "DEST=%~1"
set "PROJECT_DIR=%~dp0.."

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%t"
set "OUT=%DEST%\karim-erp-migration-%STAMP%"
mkdir "%OUT%" 2>nul
if not exist "%OUT%" goto :nodest

echo ============================================================
echo Karim ERP migration EXPORT - %STAMP%
echo Source project: %PROJECT_DIR%
echo Destination: %OUT%
echo ============================================================

echo [1/6] Database dump - local temp first, then copy to destination...
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_NAME=" "%PROJECT_DIR%\.env"') do set "DB_NAME=%%a"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_USER=" "%PROJECT_DIR%\.env"') do set "DB_USER=%%a"
for /f "tokens=2 delims==" %%a in ('findstr /B "DB_PASSWORD=" "%PROJECT_DIR%\.env"') do set "PGPASSWORD=%%a"
set "DB_NAME=%DB_NAME: =%"
set "DB_USER=%DB_USER: =%"
set "LOCALDUMP=%TEMP%\karim-db-%STAMP%.dump"
set "PG_DUMP="
for /f "delims=" %%p in ('where pg_dump.exe 2^>nul') do if not defined PG_DUMP set "PG_DUMP=%%p"
if not defined PG_DUMP if exist "%ProgramFiles%\PostgreSQL\18\bin\pg_dump.exe" set "PG_DUMP=%ProgramFiles%\PostgreSQL\18\bin\pg_dump.exe"
if not defined PG_DUMP for /f "delims=" %%p in ('dir /b /s "%ProgramFiles%\PostgreSQL\*\bin\pg_dump.exe" 2^>nul') do if not defined PG_DUMP set "PG_DUMP=%%p"
if not defined PG_DUMP (
    echo [ERROR] pg_dump.exe not found - install PostgreSQL or add its bin folder to PATH.
    exit /b 1
)
echo       using pg_dump: %PG_DUMP%
"%PG_DUMP%" -h 127.0.0.1 -U %DB_USER% -F c -Z 6 -f "%LOCALDUMP%" %DB_NAME% > "%OUT%\dbdump.log" 2>&1
if errorlevel 1 goto :dbfail
if not exist "%LOCALDUMP%" goto :dbfail
copy "%LOCALDUMP%" "%OUT%\database.dump" >nul
if errorlevel 1 goto :dbfail
del "%LOCALDUMP%" >nul 2>&1
echo       dump OK.

echo [2/6] Project code -without node_modules, logs, git-...
mkdir "%OUT%\project" >nul 2>&1
robocopy "%PROJECT_DIR%" "%OUT%\project" /E /R:1 /W:1 /XD node_modules logs .git .hg .vscode database\backups /XF *.log /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
echo       project OK.

echo [3/6] HorusData -certs, sessions, Yarasoft, media - no backups...
mkdir "%OUT%\HorusData" >nul 2>&1
robocopy "C:\HorusData" "%OUT%\HorusData" /E /R:1 /W:1 /XD whatsapp-backups /XF *.log /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
echo       HorusData OK.

echo [4/6] KarimData...
mkdir "%OUT%\KarimData" >nul 2>&1
robocopy "C:\KarimData" "%OUT%\KarimData" /E /R:1 /W:1 /XD db-backups whatsapp-backups whatsapp-sessions-backup-* /XF *.log backup.log /NFL /NDL /NJH /NJS
if errorlevel 8 goto :copyfail
echo       KarimData OK.

echo [5/6] Oracle instant client -if present-...
if exist "C:\oracle" (
    mkdir "%OUT%\oracle" >nul 2>&1
    robocopy "C:\oracle" "%OUT%\oracle" /E /R:1 /W:1 /NFL /NDL /NJH /NJS
    if errorlevel 8 goto :copyfail
    echo       oracle OK.
) else (
    echo       no C:\oracle - skipped.
)

echo [6/6] Machine profile...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=@{exported_at=Get-Date -Format o; hostname=$env:COMPUTERNAME; ips=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1'} | Select-Object -ExpandProperty IPAddress); project_path='%PROJECT_DIR%'; pg_version='18'; node_version=(node --version 2>$null); user=$env:USERNAME}; $p | ConvertTo-Json | Out-File -Encoding utf8 '%OUT%\machine-profile.json'"
echo       profile OK.

echo.
echo ============================================================
echo EXPORT DONE: %OUT%
echo Next: move this folder to the new machine and run as Admin:
echo   migrate-import.bat "%OUT%"
echo IMPORTANT: after the new machine works, STOP services here
echo   so the two machines never fight over WhatsApp.
echo ============================================================
exit /b 0

:usage
echo Usage: migrate-export.bat D:\KarimMigration
exit /b 2
:nodest
echo [ERROR] Cannot create destination %OUT%
exit /b 1
:dbfail
echo [ERROR] pg_dump failed - details in latest dbdump.log - check PostgreSQL running and disk space.
exit /b 1
:copyfail
echo [ERROR] copy failed - check disk space.
exit /b 1