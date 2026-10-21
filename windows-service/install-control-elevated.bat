@echo off
REM Karim ERP - Control companion service installer (RUN AS ADMINISTRATOR).
REM Installs KarimERP-Control on 127.0.0.1:5011. This companion stays up while
REM the ERP server is stopped, so the START button keeps working.
setlocal EnableExtensions
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 goto :need_admin
if not exist "KarimERP-Service.exe" goto :no_exe
if not exist "KarimERP-Control.xml" goto :no_xml

set LOG=%~dp0install-control.log
echo [%DATE% %TIME%] install-control started > "%LOG%"

echo [1/4] Preparing KarimERP-Control.exe...
copy /Y "KarimERP-Service.exe" "KarimERP-Control.exe" >> "%LOG%" 2>&1
if not exist "KarimERP-Control.exe" goto :copy_failed

echo [2/4] Replacing any previous instance...
KarimERP-Control.exe stop >> "%LOG%" 2>&1
KarimERP-Control.exe uninstall >> "%LOG%" 2>&1

echo [3/4] Installing and starting the companion...
KarimERP-Control.exe install >> "%LOG%" 2>&1
if errorlevel 1 goto :install_failed
sc config KarimERP-Control start= auto >> "%LOG%" 2>&1
KarimERP-Control.exe start >> "%LOG%" 2>&1

echo [4/4] Verifying 127.0.0.1:5011 ...
set OK=0
for /L %%i in (1,1,20) do (
  curl.exe -s -m 4 http://127.0.0.1:5011/api/ping | findstr /C:"\"ok\":true" >nul 2>&1
  if not errorlevel 1 ( set OK=1 & goto :ready )
  timeout /t 2 /nobreak >nul
)
:ready
if "%OK%"=="1" (
  echo [OK] Companion running - START/STOP stays available even when ERP is down.
) else (
  echo [WARN] Installed, but ping did not answer yet. Check:
  echo        logs\KarimERP-Control.out.log  and  logs\KarimERP-Control.err.log
)
echo.
echo Manage the server from: http://127.0.0.1:5011/
echo This page is loopback-only on purpose (never exposed to the internet).
pause
exit /b 0

:need_admin
echo [ERROR] ADMINISTRATOR required. Right-click - Run as administrator.
pause
exit /b 1

:no_exe
echo [ERROR] KarimERP-Service.exe not found in windows-service.
pause
exit /b 1

:no_xml
echo [ERROR] KarimERP-Control.xml not found in windows-service.
pause
exit /b 1

:copy_failed
echo [ERROR] Could not create KarimERP-Control.exe. See %LOG%
pause
exit /b 1

:install_failed
echo [ERROR] Companion service install failed. See %LOG%
pause
exit /b 1
