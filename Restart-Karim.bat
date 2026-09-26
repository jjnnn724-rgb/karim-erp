@echo off
REM Restart-Karim.bat — إعادة تشغيل سيرفسات هورس بضغطة واحدة (يطلب أدمن لوحده)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
echo [%date% %time%] Stopping karim services...
net stop KarimERP-Server
net stop KarimERP-PrintWorker
timeout /t 5 /nobreak >nul
echo [%date% %time%] Starting karim services...
net start KarimERP-Server
net start KarimERP-PrintWorker
echo.
sc query KarimERP-Server | findstr STATE
sc query KarimERP-PrintWorker | findstr STATE
echo.
pause
