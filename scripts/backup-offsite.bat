@echo off
REM ============================================================
REM Karim ERP - Weekly OFFSITE copy - second disk + optional cloud
REM Usage: backup-offsite.bat [D:\KarimOffsite]
REM Copies: latest DB dump + certs + machine identity - rotation 4 weeks
REM Cloud: if rclone exists with a remote named karim, syncs too.
REM   Setup cloud once: rclone config -new remote- then rename to karim
REM Schedule weekly as Admin:
REM   schtasks /create /tn "KarimERP-Offsite" /tr "\"<this file> D:\KarimOffsite\"" /sc weekly /d SUN /st 04:00 /ru SYSTEM
REM ============================================================
setlocal EnableExtensions
set "DEST=%~1"
if "%DEST%"=="" set "DEST=D:\KarimOffsite"
set "PROJECT_DIR=%~dp0.."
set "LOG=%DEST%\offsite.log"
mkdir "%DEST%" 2>nul
if not exist "%DEST%" goto :nodest

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "WEEK=%%t"
set "WDIR=%DEST%\%WEEK%"
mkdir "%WDIR%" 2>nul

echo [%date% %time%] offsite start to %WDIR% >> "%LOG%"

for /f "delims=" %%f in ('powershell -NoProfile -Command "Get-ChildItem C:\KarimData\db-backups\*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"') do set "LATEST=%%f"
if "%LATEST%"=="" goto :nodump
copy "%LATEST%" "%WDIR%\" >nul
if errorlevel 1 goto :copyfail

mkdir "%WDIR%\certs" >nul 2>&1
robocopy "C:\HorusData\certs" "%WDIR%\certs" /E /NFL /NDL /NJH /NJS >nul 2>&1
copy "%PROJECT_DIR%\.env" "%WDIR%\env-backup.txt" >nul 2>&1
powershell -NoProfile -Command "$p=@{host=$env:COMPUTERNAME; at=Get-Date -Format o; dump='%LATEST%'}; $p | ConvertTo-Json | Out-File -Encoding utf8 '%WDIR%\identity.json'"

where rclone >nul 2>&1
if not errorlevel 1 (
    rclone sync "%WDIR%" "karim:karim-erp-offsite/%WEEK%" --log-file="%LOG%" --log-level NOTICE
    if errorlevel 1 echo [%date% %time%] cloud sync FAILED, local copy kept >> "%LOG%"
) else (
    echo [%date% %time%] no rclone remote, local second-disk copy only >> "%LOG%"
)

powershell -NoProfile -Command "Get-ChildItem '%DEST%' -Directory | Sort-Object Name -Descending | Select-Object -Skip 4 | Remove-Item -Recurse -Force"
echo [%date% %time%] offsite OK %WDIR% >> "%LOG%"
echo OK %WDIR%
exit /b 0

:nodest
echo [ERROR] cannot create %DEST%
exit /b 1
:nodump
echo [%date% %time%] no DB dump found, run backup-database first >> "%LOG%"
echo [ERROR] no DB dump found, run backup-database.bat first.
exit /b 1
:copyfail
echo [%date% %time%] copy FAILED >> "%LOG%"
echo [ERROR] copy failed, check space on destination.
exit /b 1