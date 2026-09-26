@echo off
REM backup-daily.bat — نسخ احتياطي يومي إلى C:\KarimData\backups (مجلد قابل للكتابة)
setlocal
set "KARIM_BACKUP_DIR=C:\KarimData\backups"
set "KARIM_BACKUP_RETENTION=30"
node "%~dp0backup.js" %*
set "CODE=%ERRORLEVEL%"
endlocal & exit /b %CODE%
