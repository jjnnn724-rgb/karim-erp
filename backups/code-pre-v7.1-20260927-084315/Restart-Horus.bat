@echo off
REM Restart-Horus.bat — إعادة تشغيل سيرفسات هورس بضغطة واحدة (يطلب أدمن لوحده)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
echo [%date% %time%] Stopping karim services...
net stop HorusERP-Server
net stop HorusERP-PrintWorker
timeout /t 5 /nobreak >nul
echo [%date% %time%] Starting karim services...
net start HorusERP-Server
net start HorusERP-PrintWorker
echo.
sc query HorusERP-Server | findstr STATE
sc query HorusERP-PrintWorker | findstr STATE
echo.
pause
