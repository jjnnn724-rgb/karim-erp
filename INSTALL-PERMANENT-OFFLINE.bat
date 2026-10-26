@echo off
:: INSTALL-PERMENANT-OFFLINE.bat — تركيب دائم ل karim ERP على السيرفر 192.168.1.188 بدون Tailscale
:: شغّله كـ Administrator على السيرفر نفسه (Right-click -> Run as administrator)
:: هيشتغل حتى لو Tailscale واقع لان Oracle على نفس الجهاز 127.0.0.1:1521

setlocal EnableDelayedExpansion
echo ============================================
echo  karim ERP - Permanent Offline Installer
echo  Server: 192.168.1.188  PORT: 5000
echo  Works without Tailscale
echo ============================================

:: 1. تحقق ادمن
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [خطأ] لازم تشغل الملف كـ Administrator!
  pause
  exit /b 1
)

set KARIM_DIR=C:\KarimERP
set LOG_DIR=C:\KarimERP\logs
set DATA_DIR=C:\KarimData

echo [1/6] انشاء المجلدات...
mkdir "%KARIM_DIR%" 2>nul
mkdir "%LOG_DIR%" 2>nul
mkdir "%DATA_DIR%\Yarasoft\OraStaging" 2>nul
mkdir "%DATA_DIR%\whatsapp-sessions" 2>nul
mkdir "%DATA_DIR%\certs" 2>nul
mkdir "C:\oracle" 2>nul

echo [2/6] فك الضغط ونسخ الملفات...
:: الملف ده لازم يكون جنب karim-erp-v4.7.0.zip
:: لو بتنسخ يدوي: انسخ مجلد karim-erp كامل الى C:\KarimERP
if exist "%~dp0karim-erp-v4.7.0 (1).zip" (
  echo فك karim-erp-v4.7.0.zip الى %KARIM_DIR%...
  powershell -Command "Expand-Archive -Path '%~dp0karim-erp-v4.7.0 (1).zip' -DestinationPath '%KARIM_DIR%' -Force"
)

:: 2b. انسخ node.exe المحمول
if not exist "%KARIM_DIR%\node\node.exe" (
  mkdir "%KARIM_DIR%\node" 2>nul
  echo انسخ node.exe الى %KARIM_DIR%\node\ ...
  :: لو node.exe موجود جنب المثبت انسخه
  if exist "%~dp0node.exe" copy /Y "%~dp0node.exe" "%KARIM_DIR%\node\node.exe"
)

echo [3/6] تثبيت PostgreSQL (لو مش موجود)...
sc query postgresql-x64-16 >nul 2>&1
if %errorlevel% neq 0 (
  sc query postgresql-x64-18 >nul 2>&1
  if %errorlevel% neq 0 (
    echo PostgreSQL مش موجود - سيتم استخدام الموجود او تثبيته يدوي
    echo حمل PostgreSQL 16 من https://www.postgresql.org/download/ وثبته على بورت 5434
    echo وبعدها شغل: createdb -p 5434 -U postgres karim_erp
  ) else (
    echo PostgreSQL 18 موجود
  )
) else (
  echo PostgreSQL 16 موجود
)

echo [4/6] ضبط ملف .env للعمل بدون Tailscale...
:: يخلي Oracle على localhost لان karim هيكون على نفس السيرفر
powershell -Command "(Get-Content '%KARIM_DIR%\.env' -ErrorAction SilentlyContinue) -replace 'YARASOFT_ORACLE_HOST=.*','YARASOFT_ORACLE_HOST=127.0.0.1' | Set-Content '%KARIM_DIR%\.env' -Encoding UTF8"
:: يخلي CARD_VERIFY_BASE على IP السيرفر المحلي بدل Tailscale
powershell -Command "(Get-Content '%KARIM_DIR%\.env') -replace 'CARD_VERIFY_BASE=.*','CARD_VERIFY_BASE=http://192.168.1.188:5000' | Set-Content '%KARIM_DIR%\.env' -Encoding UTF8"
:: يخلي ALLOWED_ORIGINS يسمح للشبكة المحلية
powershell -Command "(Get-Content '%KARIM_DIR%\.env') -replace 'ALLOWED_ORIGINS=.*','ALLOWED_ORIGINS=http://192.168.1.188:5000,http://localhost:5000' | Set-Content '%KARIM_DIR%\.env' -Encoding UTF8"
type "%KARIM_DIR%\.env" | findstr "YARASOFT_ORACLE_HOST CARD_VERIFY PORT"

echo [5/6] تثبيت npm dependencies...
cd /d "%KARIM_DIR%"
if not exist "%KARIM_DIR%\node_modules" (
  "%KARIM_DIR%\node\node.exe" "%KARIM_DIR%\node\node_modules\npm\bin\npm-cli.js" install --omit=dev --loglevel=error
  if %errorlevel% neq 0 (
    echo [تحذير] npm install فشل - جرب يدوي: npm install
  )
)

echo [6/6] تركيب خدمات Windows (تعمل مع كل اعادة تشغيل وبدون Tailscale)...
:: صحح XML للمسار الدائم
powershell -Command "$xml=Get-Content '%KARIM_DIR%\windows-service\KarimERP-Service.xml' -Raw; $xml=$xml -replace 'C:\\Users\\karim\\.*\\karim-erp','C:\KarimERP' -replace 'C:\\Users\\karim\\AppData\\Local\\hermes\\node\\node.exe','C:\KarimERP\node\node.exe'; Set-Content '%KARIM_DIR%\windows-service\KarimERP-Service.xml' -Value $xml -Encoding UTF8"
powershell -Command "$xml=Get-Content '%KARIM_DIR%\windows-service\KarimERP-PrintWorker.xml' -Raw; $xml=$xml -replace 'C:\\Users\\karim\\.*\\karim-erp','C:\KarimERP' -replace 'C:\\Users\\karim\\AppData\\Local\\hermes\\node\\node.exe','C:\KarimERP\node\node.exe'; Set-Content '%KARIM_DIR%\windows-service\KarimERP-PrintWorker.xml' -Value $xml -Encoding UTF8"

:: ثبت الخدمتين
cd /d "%KARIM_DIR%\windows-service"
KarimERP-Service.exe stop 2>nul
KarimERP-Service.exe uninstall 2>nul
timeout /t 2 /nobreak >nul
KarimERP-Service.exe install
if %errorlevel% neq 0 (
  echo [خطأ] فشل تثبيت KarimERP-Server
) else (
  KarimERP-Service.exe start
  echo KarimERP-Server تم تثبيته ويعمل تلقائيا مع الويندوز
)

KarimERP-PrintWorker.exe stop 2>nul
KarimERP-PrintWorker.exe uninstall 2>nul
timeout /t 2 /nobreak >nul
KarimERP-PrintWorker.exe install
KarimERP-PrintWorker.exe start

:: افتح الفايروول للشبكة المحلية (بدون Tailscale)
netsh advfirewall firewall delete rule name="karim ERP 5000" >nul 2>&1
netsh advfirewall firewall add rule name="karim ERP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any >nul
netsh advfirewall firewall delete rule name="karim ERP Postgres 5434" >nul 2>&1
netsh advfirewall firewall add rule name="karim ERP Postgres 5434" dir=in action=allow protocol=TCP localport=5434 profile=any >nul

echo.
echo ============================================
echo  تم! karim شغال دائم بدون Tailscale
echo  جرب من اي جهاز في المكتب:
echo    http://192.168.1.188:5000
echo  الخدمات:
sc query KarimERP-Server
sc query KarimERP-PrintWorker
echo  السجلات: C:\KarimERP\logs
echo  اعادة التشغيل تلقائية حتى لو Tailscale واقع
echo ============================================
pause
