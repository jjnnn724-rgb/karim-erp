@echo off
REM Karim ERP - Remove Windows Services.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 goto :need_admin

KarimERP-Service.exe stop >nul 2>&1
KarimERP-Service.exe uninstall
if exist "KarimERP-PrintWorker.exe" goto :rm_worker
goto :done

:rm_worker
KarimERP-PrintWorker.exe stop >nul 2>&1
KarimERP-PrintWorker.exe uninstall
goto :done

:need_admin
echo [ERROR] Run as Administrator.
pause
exit /b 1

:done
echo [OK] Services removed.
exit /b 0
