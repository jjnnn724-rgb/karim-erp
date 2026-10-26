@echo off
REM ============================================================
REM Karim ERP - Enable API_KEY protection - run once, then restart service
REM - Generates a random 32-char key and appends API_KEY= to .env once
REM - Safe to rerun: never overwrites an existing key
REM - After this: sc stop/start KarimERP-Server, then all users
REM   re-login once - browsers fetch the key automatically
REM - Rollback anytime: delete the API_KEY line from .env + restart
REM ============================================================
setlocal EnableExtensions
cd /d "%~dp0.."
if not exist ".env" goto :noenv
findstr /B "API_KEY=" ".env" >nul 2>&1
if not errorlevel 1 goto :exists
for /f %%k in ('powershell -NoProfile -Command "$r=[Security.Cryptography.RandomNumberGenerator]::Create(); $b=New-Object byte[] 24; $r.GetBytes($b); [BitConverter]::ToString($b).Replace('-','').ToLower()"') do set "KEY=%%k"
echo.>> ".env"
echo API_KEY=%KEY%>> ".env"
echo [OK] API_KEY enabled. Restart the service now:
echo   sc stop KarimERP-Server
echo   sc start KarimERP-Server
exit /b 0
:noenv
echo [ERROR] .env not found next to this script.
exit /b 1
:exists
echo [OK] API_KEY already set - nothing changed.
exit /b 0