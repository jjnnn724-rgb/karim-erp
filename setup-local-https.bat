@echo off
REM ============================================================
REM Karim ERP - Local Development HTTPS with mkcert
REM Quick setup for local development with trusted certificates
REM Run as Administrator
REM ============================================================

@echo off
setlocal EnableDelayedExpansion EnableExtensions

echo ============================================================
echo Karim ERP - Local HTTPS with mkcert (Zero-Config)
echo ============================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Run as Administrator
    pause
    exit /b 1
)

echo [INFO] Using the trusted LAN deployment flow.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-lan-trust.ps1"
if errorlevel 1 (
    echo [ERROR] Trusted LAN HTTPS setup failed.
    pause
    exit /b 1
)
echo.
echo [NEXT] Copy C:\HorusData\certs\Karim-Local-CA.crt to every client device.
echo [NEXT] Run Install-Karim-CA.bat as Administrator on Windows clients.
echo [NEXT] Restart KarimERP-Server, then use the printed LAN URL.
pause
exit /b 0

echo [1/5] Installing mkcert...
choco install mkcert -y --no-progress 2>nul
if errorlevel 1 (
    echo [INFO] Installing via scoop...
    scoop install mkcert 2>nul
)
if not exist "%USERPROFILE%\scoop\apps\mkcert\current\mkcert.exe" if not exist "%USERPROFILE%\scoop\apps\mkcert\mkcert.exe" if not exist "C:\ProgramData\chocolatey\bin\mkcert.exe" (
    echo [ERROR] mkcert installation failed
    pause
    exit /b 1
)

echo [2/5] Installing local CA...
mkcert -install

echo [3/5] Generating certificates for local development...
mkcert -install
mkcert karim-erp.local "*.karim-erp.local" localhost 127.0.0.1 ::1

echo [4/5] Copying certificates to nginx...
if not exist "C:\nginx\ssl" mkdir "C:\nginx\ssl"
copy /Y karim-erp.local+*.pem "C:\nginx\ssl\karim-erp.local.pem" >nul
copy /Y karim-erp.local+*-key.pem "C:\nginx\ssl\karim-erp.local-key.pem" >nul

echo [4/5] Updating nginx config for mkcert certificates...
powershell -Command "
    (Get-Content 'C:\nginx\conf\nginx.conf') -replace 'ssl_certificate /etc/letsencrypt/live/your-domain/fullchain.pem;', 'ssl_certificate C:/nginx/ssl/karim-erp.local.pem;' -replace 'ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;', 'ssl_certificate_key C:/nginx/ssl/karim-erp.local-key.pem;' | Set-Content 'C:\nginx/conf/nginx.conf'
"

echo [5/5] Restarting nginx...
C:\nginx\nginx.exe -s reload 2>nul
Start-Sleep -Seconds 2

echo.
echo ============================================================
echo [SUCCESS] Local HTTPS ready!
echo ============================================================
echo.
echo Add to Windows hosts file (C:\Windows\System32\drivers\etc\hosts):
echo   127.0.0.1 karim-erp.local
echo.
echo Access: https://karim-erp.local/app/index.html
echo.
echo Certificate valid for: karim-erp.local, *.karim-erp.local, localhost, 127.0.0.1, ::1
echo.
pause