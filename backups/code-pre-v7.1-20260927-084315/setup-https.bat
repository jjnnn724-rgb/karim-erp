@echo off
REM ============================================================
REM Karim ERP - Professional HTTPS Setup with Let's Encrypt
REM Automated certificate generation and nginx setup
REM Run as Administrator
REM ============================================================

@echo off
setlocal EnableDelayedExpansion EnableExtensions

echo ============================================================
echo Karim ERP - Professional HTTPS Setup with Let's Encrypt
echo ============================================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script requires Administrator privileges.
    echo Please run as Administrator (Right-click -> Run as Administrator)
    pause
    exit /b 1
)

set "NGINX_DIR=C:\nginx"
set "CERTBOT_DIR=C:\Certbot"
set "DOMAIN=karim-erp.local"
set "EMAIL=admin@karim-erp.local"

echo [1/6] Checking prerequisites...

REM Check if nginx exists
if not exist "%NGINX_DIR%\nginx.exe" (
    echo [INFO] Nginx not found. Downloading...
    powershell -Command "Invoke-WebRequest -Uri 'https://nginx.org/download/nginx-1.26.0.zip' -OutFile '%TEMP%\nginx.zip'; Expand-Archive -Path '%TEMP%\nginx.zip' -DestinationPath '%NGINX_DIR%' -Force"
    if not exist "%NGINX_DIR%\nginx.exe" (
        echo [ERROR] Failed to download nginx
        pause
        exit /b 1
    )
)

REM Check if certbot exists
if not exist "%CERTBOT_DIR%\certbot.exe" (
    echo [INFO] Certbot not found. Installing via Chocolatey...
    powershell -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" 2>$null
    choco install certbot -y --no-progress 2>nul
    if not exist "%CERTBOT_DIR%\certbot.exe" (
        echo [ERROR] Failed to install certbot. Please install manually from https://certbot.eff.org/
        pause
        exit /b 1
    )
)

echo [2/6] Setting up directories...
if not exist "%NGINX_DIR%\conf" mkdir "%NGINX_DIR%\conf"
if not exist "%NGINX_DIR%\logs" mkdir "%NGINX_DIR%\logs"
if not exist "%NGINX_DIR%\cache" mkdir "%NGINX_DIR%\cache"
if not exist "C:\var\www\letsencrypt" mkdir "C:\var\www\letsencrypt"
if not exist "C:\var\cache\nginx" mkdir "C:\var\cache\nginx"

echo [3/6] Copying nginx configuration...
copy /Y "%~dp0nginx.conf" "%NGINX_DIR%\conf\nginx.conf" >nul

echo [4/6] Installing and starting nginx service...
"%NGINX_DIR%\nginx.exe" -p "%NGINX_DIR%" -t 2>&1
if errorlevel 1 (
    echo [ERROR] Nginx configuration test failed
    pause
    exit /b 1
)

REM Install nginx as Windows service using nssm
if not exist "C:\nssm\nssm.exe" (
    echo [INFO] Downloading NSSM...
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%TEMP%\nssm.zip'; Expand-Archive -Path '%TEMP%\nssm.zip' -DestinationPath 'C:\nssm' -Force"
)

if not exist "%NGINX_DIR%\nginx-service.exe" copy "C:\nssm\nssm-2.24\win64\nssm.exe" "%NGINX_DIR%\nginx-service.exe" >nul
"%NGINX_DIR%\nginx-service.exe" install "KarimERP-Nginx" "%NGINX_DIR%\nginx.exe" "-p %NGINX_DIR%" 2>nul
"%NGINX_DIR%\nginx-service.exe" set "KarimERP-Nginx" Start SERVICE_AUTO_START
"%NGINX_DIR%\nginx-service.exe" set "KarimERP-Nginx" Description "Karim ERP Nginx Reverse Proxy"
"%NGINX_DIR%\nginx-service.exe" start "KarimERP-Nginx"

echo [5/6] Generating Let's Encrypt certificate...
echo [INFO] Using DNS challenge for local domain: %DOMAIN%
echo [INFO] Make sure DNS A record for %DOMAIN% points to this server's IP

REM Generate certificate using DNS challenge (works for local domains)
"%CERTBOT_DIR%\certbot.exe" certonly --dns-cloudflare ^
    --dns-cloudflare-credentials "C:\cloudflare.ini" ^
    -d "%DOMAIN%" -d "*.%DOMAIN%" ^
    --non-interactive --agree-tos --email %EMAIL% ^
    --preferred-challenges dns ^
    --server https://acme-v02.api.letsencrypt.org/directory 2>&1

if errorlevel 1 (
    echo [WARN] DNS challenge failed. Trying HTTP challenge...
    "%CERTBOT_DIR%\certbot.exe" certonly --standalone ^
        -d %DOMAIN% ^
        --non-interactive --agree-tos --email %EMAIL% ^
        --preferred-challenges http ^
        --server https://acme-v02.api.letsencrypt.org/directory 2>&1
)

if errorlevel 1 (
    echo [ERROR] Certificate generation failed.
    echo [INFO] For local development, you can use mkcert instead:
    echo         choco install mkcert -y
    echo         mkcert -install
    echo         mkcert %DOMAIN% *.%DOMAIN% localhost 127.0.0.1 ::1
    pause
    exit /b 1
)

echo [6/6] Setting up auto-renewal...
"%CERTBOT_DIR%\certbot.exe" renew --dry-run

echo.
echo ============================================================
echo [SUCCESS] HTTPS setup complete!
echo ============================================================
echo.
echo Nginx is running as Windows service: KarimERP-Nginx
echo Certificates auto-renew via Certbot (check Task Scheduler)
echo.
echo Next steps:
echo 1. Replace 'your-domain' in nginx.conf with your actual domain
echo 2. Point DNS A record to this server's IP
echo 3. Access https://%DOMAIN%/app/index.html
echo.
echo For local development without domain:
echo   choco install mkcert -y
echo   mkcert -install
echo   mkcert karim-erp.local *.karim-erp.local localhost 127.0.0.1 ::1
echo   Then update nginx.conf ssl_certificate paths
echo.
pause