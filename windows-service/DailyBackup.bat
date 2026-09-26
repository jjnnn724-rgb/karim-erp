@echo off
REM Karim ERP - Daily backup - Windows Task Scheduler.
setlocal EnableExtensions
set "APP_DIR=%~dp0.."
set "LOG_DIR=%ProgramData%\KarimERP\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
node "%APP_DIR%\database\scripts\backup.js" >> "%LOG_DIR%\daily-backup.log" 2>&1
exit /b %ERRORLEVEL%
