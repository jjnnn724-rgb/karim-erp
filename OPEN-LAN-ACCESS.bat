@echo off
REM ============================================================
REM  Karim ERP - Open LAN access
REM  Run this ONCE on the SERVER (RemoteHome machine).
REM  It asks for admin, opens firewall TCP 5000, shows the
REM  server IP and tests the local server.
REM ============================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
echo.
echo === Server LAN IP addresses (use one of these on other devices) ===
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object IPAddress | Format-Table -AutoSize"
echo.
echo === Opening Windows Firewall for TCP 5000 (inbound) ===
netsh advfirewall firewall delete rule name="KarimERP-5000" >nul 2>&1
netsh advfirewall firewall delete rule name="KarimERP-5000-Public" >nul 2>&1
netsh advfirewall firewall add rule name="KarimERP-5000" dir=in action=allow protocol=TCP localport=5000 profile=private,domain
netsh advfirewall firewall add rule name="KarimERP-5000-Public" dir=in action=allow protocol=TCP localport=5000 profile=public
echo.
echo === Testing local server ===
REM curl.exe -k يثق بالشهادة المحلية تلقائيًا — يعمل على كل إصدارات Windows 10/11
curl.exe -k -s -o NUL -w "HTTPS health check: HTTP %%{http_code}\n" --max-time 8 https://127.0.0.1:5000/api/health
if %errorLevel% neq 0 echo (لو فشل: تأكد أن KARIMERP.bat يعمل الآن)
echo.
echo === Done ===
echo On any phone/PC on the SAME WiFi/LAN open:
echo   https://SERVER-IP:5000/app/index.html
echo (replace SERVER-IP with one of the addresses printed above)
echo.
echo If the browser warns about the certificate:
echo   install the CA first on that device - open in the browser:
echo     https://SERVER-IP:5000/app/Karim-Local-CA.crt
echo   double-click the downloaded file -^> Install Certificate -^> Local
echo   Machine -^> "Place all certificates in the following store" -^>
echo   Browse -^> "Trusted Root Certification Authorities" -^> Finish,
echo   then restart the browser completely. After that the site opens
echo   with no warning (and the phone app icon can be added).
echo   Or as a quick bypass: click Advanced -^> Proceed.
echo.
pause
