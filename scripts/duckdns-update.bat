@echo off
REM Karim ERP - DuckDNS IP updater - keeps karimerp.duckdns.org pointing at this server
REM Token file: C:\KarimData\duckdns-token.txt - single line, the token only
REM Schedule as Admin every 10 minutes:
REM   schtasks /create /tn "KarimERP-DuckDNS" /tr "'C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp\scripts\duckdns-update.bat'" /sc minute /mo 10 /ru SYSTEM /f
setlocal EnableExtensions
set "TOKENFILE=C:\KarimData\duckdns-token.txt"
set "LOG=C:\KarimData\duckdns.log"
if not exist "%TOKENFILE%" goto :notoken
set /p TOKEN=<"%TOKENFILE%"
set "TOKEN=%TOKEN: =%"
for /f %%r in ('curl -s "https://www.duckdns.org/update?domains=karimerp&token=%TOKEN%&ip="') do set "RESP=%%r"
if "%RESP%"=="OK" goto :ok
echo [%date% %time%] DuckDNS update FAILED resp=%RESP% >> "%LOG%"
exit /b 1
:ok
for /f %%i in ('curl -s https://api.ipify.org') do set "NOWIP=%%i"
set "LASTFILE=C:\KarimData\duckdns-lastip.txt"
set "LAST="
if exist "%LASTFILE%" set /p LAST=<"%LASTFILE%"
if not "%NOWIP%"=="%LAST%" echo [%date% %time%] public IP now %NOWIP% >> "%LOG%"
echo %NOWIP% > "%LASTFILE%"
exit /b 0
:notoken
echo [%date% %time%] token file missing %TOKENFILE% >> "%LOG%"
exit /b 2