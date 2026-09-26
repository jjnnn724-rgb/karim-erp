@echo off
REM Install-Karim-CA.bat - تثبيت جذر شهادة LAN على جهاز عميل
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
set "CA_FILE=%~dp0Karim-Local-CA.crt"
if exist "C:\HorusData\certs\Karim-Local-CA.crt" set "CA_FILE=C:\HorusData\certs\Karim-Local-CA.crt"
if not exist "%CA_FILE%" (
    echo FAILED - CA file not found. Run setup-lan-trust.ps1 on the ERP server first,
    echo then copy C:\HorusData\certs\Karim-Local-CA.crt next to this file.
    pause
    exit /b 1
)
certutil -addstore -f root "%CA_FILE%"
if %errorLevel% equ 0 (
    echo OK - CA installed. Restart the browser completely.
) else (
    echo FAILED - certutil error %errorLevel%
)
echo.
pause
