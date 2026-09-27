@echo off
REM ============================================================
REM  CLIENT-SETUP.bat - Turn this PC into a KARIM ERP client
REM  (Thin client: shows the central server UI only - no local
REM   database, no local services. Login decides your permissions.)
REM
REM  Usage:  CLIENT-SETUP.bat                (default server)
REM          CLIENT-SETUP.bat https://OTHER-IP:5000
REM
REM  Run AFTER installing the Karim ERP desktop app.
REM  To revert this PC to server mode: delete the config file
REM  printed below.
REM ============================================================
setlocal EnableExtensions
set "URL=https://192.168.1.165:5000"
if not "%~1"=="" set "URL=%~1"

set "CFGDIR=%APPDATA%\karim-erp"
if not exist "%CFGDIR%" mkdir "%CFGDIR%"
> "%CFGDIR%\server-target.json" echo {"serverUrl":"%URL%"}

echo.
echo ============================================================
echo  [OK] This PC is now a KARIM ERP CLIENT
echo       Server : %URL%
echo       Config : %CFGDIR%\server-target.json
echo ============================================================
echo.
echo  Next steps (once):
echo   1) Install the security certificate - open in any browser:
echo         %URL%/app/Karim-Local-CA.crt
echo      Double-click the downloaded file -^> Install Certificate
echo      -^> Local Machine -^> Next -^> "Place all certificates in
echo      the following store" -^> Browse -^> Trusted Root
echo      Certification Authorities -^> Finish.
echo   2) Start the Karim ERP app and log in with YOUR account.
echo      (Your permissions come from the server on every login.)
echo.
echo  To undo client mode: delete
echo      %CFGDIR%\server-target.json
echo.
pause
