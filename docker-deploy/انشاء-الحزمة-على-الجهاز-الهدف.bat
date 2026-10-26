@echo off
chcp 65001 >nul
echo ================================================
echo  Karim ERP - انشاء حزمة النشر على هذا الجهاز
echo  (انسخ هذا الملف ونفذه من جذر المشروع)
echo ================================================
cd /d "%~dp0\..\.."
xcopy backend docker-build\backend\ /E /I /Y >nul
xcopy frontend docker-build\frontend\ /E /I /Y >nul
xcopy database docker-build\database\ /E /I /Y >nul
xcopy scripts docker-build\scripts\ /E /I /Y >nul
xcopy common docker-build\common\ /E /I /Y >nul
copy package.json docker-build\ >nul
copy package-lock.json docker-build\ >nul
xcopy docker-deploy docker-build\ /E /I /Y >nul
echo تم! الحزمة في مجلد docker-build
pause
