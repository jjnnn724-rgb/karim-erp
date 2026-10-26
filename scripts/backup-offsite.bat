@echo off
REM ============================================================
REM Karim ERP - Weekly OFFSITE copy - second disk + optional cloud
REM Usage: backup-offsite.bat [D:\KarimOffsite]
REM Copies: latest GPG-encrypted full backup + SHA-256 only - rotation 4 weeks
REM Cloud: if rclone exists with a remote named karim, syncs too.
REM   Setup cloud once: rclone config -new remote- then rename to karim
REM Schedule weekly as Admin:
REM   schtasks /create /tn "KarimERP-Offsite" /tr "\"<this file> D:\KarimOffsite\"" /sc weekly /d SUN /st 04:00 /ru SYSTEM
REM ============================================================
setlocal EnableExtensions
set "DEST=%~1"
if "%DEST%"=="" set "DEST=D:\KarimOffsite"
set "LOG=%DEST%\offsite.log"
mkdir "%DEST%" 2>nul
if not exist "%DEST%" goto :nodest

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "WEEK=%%t"
set "WDIR=%DEST%\%WEEK%"
mkdir "%WDIR%" 2>nul

echo [%date% %time%] offsite start to %WDIR% >> "%LOG%"

for /f "delims=" %%f in ('powershell -NoProfile -Command "Get-ChildItem C:\KarimData\backups\karim_FULL_*.zip.gpg -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"') do set "LATEST=%%f"
if "%LATEST%"=="" goto :noencrypted
if not exist "%LATEST%.sha256" goto :nohash
powershell -NoProfile -Command "$actual=(Get-FileHash -Algorithm SHA256 -LiteralPath '%LATEST%').Hash; $expected=(Get-Content -LiteralPath '%LATEST%.sha256' -TotalCount 1).Split(' ')[0]; if($actual -ne $expected){exit 1}"
if errorlevel 1 goto :hashfail
copy "%LATEST%" "%WDIR%\" >nul
if errorlevel 1 goto :copyfail
copy "%LATEST%.sha256" "%WDIR%\" >nul
if errorlevel 1 goto :copyfail
powershell -NoProfile -Command "$p=@{host=$env:COMPUTERNAME; at=Get-Date -Format o; encryptedArchive=[IO.Path]::GetFileName('%LATEST%')}; $p | ConvertTo-Json | Out-File -Encoding utf8 '%WDIR%\identity.json'"
if errorlevel 1 goto :copyfail

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
:noencrypted
echo [%date% %time%] no encrypted full backup found; refusing raw offsite copy >> "%LOG%"
echo [ERROR] no GPG-encrypted full backup found. Run backup-full.ps1 after configuring GPG recipient.
exit /b 1
:nohash
echo [%date% %time%] encrypted backup SHA-256 sidecar is missing >> "%LOG%"
echo [ERROR] encrypted backup SHA-256 sidecar missing.
exit /b 1
:hashfail
echo [%date% %time%] encrypted backup SHA-256 verification failed >> "%LOG%"
echo [ERROR] encrypted backup checksum mismatch.
exit /b 1
:copyfail
echo [%date% %time%] copy FAILED >> "%LOG%"
echo [ERROR] copy failed, check space on destination.
exit /b 1