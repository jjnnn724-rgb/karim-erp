@echo off
REM Karim ERP — Restart. Stop then start in a new window.
setlocal EnableExtensions
title Karim ERP - Restarting
cd /d "%~dp0"

echo [%time%] Stopping Karim ERP...
node scripts\stop.js >nul 2>&1
timeout /t 3 /nobreak >nul

echo [%time%] Starting Karim ERP in a new window...
start "Karim ERP - Running" cmd /k node scripts\serve.js

echo.
echo Done. Server window opened (closing that window stops the server).
timeout /t 3 /nobreak >nul
exit /b 0
