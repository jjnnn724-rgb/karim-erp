@echo off
REM Karim ERP - Install Windows Services - smart, portable.
setlocal EnableExtensions
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 goto :need_admin
if not exist "KarimERP-Service.exe" goto :no_exe

echo [1/2] Installing KarimERP-Server...
KarimERP-Service.exe install
KarimERP-Service.exe start

echo [2/2] Installing KarimERP-PrintWorker...
if exist "KarimERP-PrintWorker.exe" goto :install_worker
echo [WARN] PrintWorker exe missing - server only.
goto :done

:install_worker
KarimERP-PrintWorker.exe install
KarimERP-PrintWorker.exe start
goto :done

:need_admin
echo [ERROR] Run as Administrator - right click, Run as administrator.
pause
exit /b 1

:no_exe
echo [ERROR] KarimERP-Service.exe not found in windows-service.
pause
exit /b 1

:done
echo.
echo [OK] Services installed. Check services.msc - Karim ERP Server.
pause
exit /b 0
