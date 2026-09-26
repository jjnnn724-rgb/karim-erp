@echo off
REM Karim ERP - Services status.
setlocal
cd /d "%~dp0"
KarimERP-Service.exe status
if exist "KarimERP-PrintWorker.exe" KarimERP-PrintWorker.exe status
sc query KarimERP-Server | findstr STATE
exit /b 0
