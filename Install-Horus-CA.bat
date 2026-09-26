@echo off
REM Install-Horus-CA.bat — تثبيت جذر الشهادة المحلية في الويندوز (مرة واحدة لكل جهاز)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
certutil -addstore root "%~dp0Horus-Local-CA.crt"
if %errorLevel% equ 0 (
    echo OK - CA installed. Restart Chrome completely and reopen https://localhost:5000
) else (
    echo FAILED - certutil error %errorLevel%
)
echo.
pause
