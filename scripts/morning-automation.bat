@echo off
REM KarimERP morning automation - runs chained under SYSTEM, fully hands-free.
REM Order: task self-repair -> fingerprint dual-ID sync -> health+integrity -> log rotation. Zero manual steps.
setlocal
set ERP=C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp
set LOGF=%ERP%\logs\morning-automation.log
echo [%date% %time%] ===== morning automation start ===== >> "%LOGF%"
cd /d "%ERP%"
C:\nodejs\node.exe scripts\task-guard.js >> "%LOGF%" 2>&1
echo [%date% %time%] guard exit=%ERRORLEVEL% >> "%LOGF%"
C:\nodejs\node.exe scripts\attendance-selftest.js >> "%LOGF%" 2>&1
echo [%date% %time%] selftest exit=%ERRORLEVEL% >> "%LOGF%"
C:\nodejs\node.exe scripts\zk-id-sync.js >> "%LOGF%" 2>&1
echo [%date% %time%] id-sync exit=%ERRORLEVEL% >> "%LOGF%"
C:\nodejs\node.exe scripts\attendance-health.js >> "%LOGF%" 2>&1
echo [%date% %time%] health exit=%ERRORLEVEL% >> "%LOGF%"
C:\nodejs\node.exe scripts\rotate-logs.js >> "%LOGF%" 2>&1
echo [%date% %time%] rotate exit=%ERRORLEVEL% >> "%LOGF%"
echo [%date% %time%] ===== morning automation end ===== >> "%LOGF%"
exit /b 0
