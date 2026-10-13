@echo off
REM Karim ERP - Full services install (RUN AS ADMINISTRATOR).
REM 1) ERP backend as Windows service (any user / no login needed)
REM 2) Cloudflared connector as Windows service
REM 3) SYSTEM watchdog task every 5 min (self-healing engineer)
setlocal EnableExtensions
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] ADMINISTRATOR required. Right-click - Run as administrator.
  pause
  exit /b 1
)

set ROOT=C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp
set LOG=C:\cloudflared\install-all.log
echo [%DATE% %TIME%] install-all started > "%LOG%"

echo [1/4] Installing ERP backend service...
KarimERP-Service.exe stop >> "%LOG%" 2>&1
KarimERP-Service.exe uninstall >> "%LOG%" 2>&1
KarimERP-Service.exe install >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] ERP service install failed. See %LOG%
  pause
  exit /b 1
)
echo   Stopping manually-started node so the service owns port 5000...
taskkill /F /IM node.exe >> "%LOG%" 2>&1
timeout /t 5 /nobreak >nul
KarimERP-Service.exe start >> "%LOG%" 2>&1
echo   Waiting for health...
set OK=0
for /L %%i in (1,1,24) do (
  curl.exe -k -s -m 8 https://127.0.0.1:5000/api/health | findstr /C:"\"status\":\"ok\"" >nul 2>&1
  if not errorlevel 1 ( set OK=1 & goto erpok )
  timeout /t 5 /nobreak >nul
)
echo [ERROR] ERP did not become healthy. See %LOG%
pause
exit /b 1
:erpok
echo   ERP service healthy.
>> "%LOG%" echo ERP service healthy.

echo [2/4] Installing Cloudflared service...
taskkill /F /IM cloudflared.exe >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul
set /p CF_TOKEN=<C:\cloudflared\tunnel-token.txt
C:\cloudflared\cloudflared.exe service uninstall >> "%LOG%" 2>&1
C:\cloudflared\cloudflared.exe service install "%CF_TOKEN%" >> "%LOG%" 2>&1
sc config Cloudflared start= auto >> "%LOG%" 2>&1
net start Cloudflared >> "%LOG%" 2>&1
timeout /t 12 /nobreak >nul
sc query Cloudflared | findstr "RUNNING" >nul 2>&1
if errorlevel 1 (
  echo [WARN] Cloudflared service not running - starting process fallback...
  start "" /MIN C:\cloudflared\run-tunnel.bat
) else (
  echo   Cloudflared service running.
)

echo [3/4] Registering SYSTEM watchdog (every 5 min)...
schtasks /create /tn KarimERP-Watchdog-SYSTEM /tr "C:\nodejs\node.exe \"%ROOT%\scripts\watchdog.js\" --fix" /sc minute /mo 5 /ru SYSTEM /f >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [WARN] SYSTEM task failed - keeping user-level tasks only.
) else (
  echo   Watchdog SYSTEM task ready.
)

echo [4/4] Verifying...
curl.exe -k -s -m 8 https://127.0.0.1:5000/api/health | findstr /C:"\"status\":\"ok\"" >nul 2>&1
if errorlevel 1 ( echo [WARN] Local API not OK yet - check shortly. ) else ( echo   Local API: OK )
curl.exe -4 -k -s -m 15 https://karimeg.online/api/health | findstr /C:"\"status\":\"ok\"" >nul 2>&1
if errorlevel 1 ( echo [WARN] Public domain not OK yet - tunnel may need a minute. ) else ( echo   Public domain: OK )

echo.
echo [DONE] System runs as services - independent of logged-in user.
echo        Reboot-safe: PostgreSQL(auto) + ERP(auto) + Cloudflared(auto) + watchdog(5min).
pause
exit /b 0
