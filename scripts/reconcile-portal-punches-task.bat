@echo off
C:\nodejs\node.exe "%~dp0reconcile-portal-punches.js" >> "%~dp0..\database\backups\punch-reconcile.log" 2>&1
REM Auto-heal forgotten checkouts every 30 min (idempotent, inferred+reversible)
C:\nodejs\node.exe "%~dp0zk-close-stale.js" >> "%~dp0..\logs\stale-close.log" 2>&1
REM Morning automation (runs once daily ~07:18 with this 30-min task): fingerprint dual-ID sync + health check
for /f "tokens=1 delims=:" %%a in ("%time%") do set HH=%%a
set HH=%HH: =%
if "%HH%"=="7" call "%~dp0morning-automation.bat"
