@echo off
REM Restart-Karim.bat — إعادة تشغيل Karim ERP (واجهة توافق للعادة القديمة).
REM ────────────────────────────────────────────────────────────────────────────
REM النسخة القديمة كانت تنفّذ net stop/start لخدمات (KarimERP-Server) غير مسطبة
REM أصلًا — فلا تفعل شيئًا غير فتح شاشة سوداء. الآن كل المنطق في:
REM   RESTART-KARIM.vbs + scripts\restart-server.ps1  (مخفي بالكامل + فحص صحة)
REM للنقر المزدوج بدون أي شاشة استخدم RESTART-KARIM.vbs مباشرة أو اختصار سطح المكتب.
wscript.exe "%~dp0RESTART-KARIM.vbs"
exit /b 0
