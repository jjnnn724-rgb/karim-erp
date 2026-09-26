@echo off
echo ============================================
echo  شهادة Horus ERP — تثبيت على الكمبيوتر
echo ============================================
echo.
echo هذا السكريبت يثبت شهادة SSL المحلية
echo لكي لا يظهر تحذير امان عند الدخول على:
echo https://192.168.1.165:5001
echo.
echo سيتم تثبيت الشهادة في:
echo   الجذر الموثوق (Trusted Root Certification Authorities)
echo.
set /p CONFIRM=هل تريد تثبيت الشهادة؟ (Y/N): 
if /i "%CONFIRM%" neq "Y" goto END

:: تثبيت الشهادة في الجذر الموثوق (جميع المستخدمين)
certutil -addstore Root "C:\HorusData\certs\horus-local-ca.crt" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] تم تثبيت الشهادة بنجاح!
    echo يمكنك الان الدخول على: https://192.168.1.165:5001
) else (
    echo [ERROR] فشل تثبيت الشهادة. حاول كمدير.
    echo جرّب: certutil -addstore Root "C:\HorusData\certs\horus-local-ca.crt"
)
goto END

:END
echo.
echo انتهى.
pause
