@echo off
:: ============================================================
::  Horus ERP v4.7.0 — Permanent Auto-Start Setup
::  ============================================================
::  Run as Administrator for system-level auto-start.
::  Without admin: falls back to Startup folder.
:: ============================================================

setlocal enabledelayedexpansion
set "PROJECT_DIR=C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp"
set "NODE_EXE=C:\Users\RemoteHome\AppData\Local\hermes\node\node.exe"
set "RUN_BAT=%PROJECT_DIR%\scripts\run-server.bat"
set "TASK_SERVER=HorusERP-Server"
set "TASK_MONITOR=HorusERP-Monitor"

echo.
echo ============================================
echo  Horus ERP v4.7.0 — Permanent Auto-Start
echo ============================================
echo.

:: Check admin rights
net session >nul 2>&1
if errorlevel 1 (
    echo [!] Admin rights not available — using Startup folder method.
    goto :USER_MODE
)

:: ===== ADMIN: Register System-Level Tasks =====
schtasks /DELETE /TN "%TASK_SERVER%" /F 2>nul
schtasks /DELETE /TN "%TASK_MONITOR%" /F 2>nul

schtasks /CREATE /TN "%TASK_SERVER%" /TR "\"%RUN_BAT%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /DELAY 00:30 2>nul
schtasks /CREATE /TN "%TASK_MONITOR%" /TR "\"%RUN_BAT%\"" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F /DELAY 00:30 2>nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v "HorusERP-Server" /t REG_SZ /d "\"%RUN_BAT%\"" /f 2>nul

echo [+] System-level tasks created (SYSTEM account).
echo [+] Server starts on every boot, regardless of user.
goto :END

:USER_MODE
:: ===== NON-ADMIN: Startup Folder =====
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HorusERP-start.bat" (
    copy "%PROJECT_DIR%\Startup\HorusERP-start.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\" >nul 2>&1
)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "HorusERP-Server" /t REG_SZ /d "\"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HorusERP-start.bat\"" /f 2>nul
echo [+] Startup folder configured. Server starts when you log in.

:END
echo.
curl -k -s https://localhost:5001/api/health | findstr "ok" >nul 2>&1
if errorlevel 1 (
    echo [!] Server not running. Starting...
    start "" "%RUN_BAT%"
) else (
    echo [+] Server running on port 5001.
)
echo.
pause
