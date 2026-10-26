@echo off
REM Karim ERP - zrok public share - USER session launcher
REM Double-click after every reboot/logon, LEAVE the window open.
REM Stable URL: https://karim-erp.shares.zrok.io
REM To auto-start: copy a shortcut of THIS file into shell:startup
title KarimERP zrok share - LEAVE OPEN
C:\KarimTools\zrok\zrok.exe share public --backend-mode proxy --insecure --headless -n public:karim-erp https://127.0.0.1:5001
echo.
echo [share stopped - restart this file to bring the public URL back]
pause
