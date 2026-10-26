@echo off
REM Karim ERP - DANGER: full database reset - dev only!
REM Safer alternative: windows-scripts\resetdb-windows.bat
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  DANGER: FORMAT and CLEAN RESET - Karim ERP
echo  This will ERASE the database permanently!
echo ========================================
echo.
set /p CONFIRM="Type YES to continue: "
if /i not "%CONFIRM%"=="YES" goto :cancel

echo [1/4] Stopping this project node processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*karim*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
timeout /t 2 /nobreak >nul

echo [2/4] Dropping and recreating database...
node database\scripts\cleanup-pg.js
if errorlevel 1 goto :failed

echo [3/4] Running all migrations...
node database\scripts\run-migration.js
if errorlevel 1 goto :failed

echo [4/4] Verifying backend syntax...
node --check backend\server.js
if errorlevel 1 goto :failed

echo.
echo ========================================
echo  FORMAT COMPLETE - System Ready. Run: RUN-KARIM.bat
echo ========================================
pause
exit /b 0

:failed
echo [ERROR] Step failed - stopped to protect your data.
pause
exit /b 1

:cancel
echo Cancelled.
exit /b 0
