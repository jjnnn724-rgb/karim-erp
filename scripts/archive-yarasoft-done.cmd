@echo off
rem archive-yarasoft-done.cmd — أرشفة ملفات ياراسوفت المعالجة (.done) إلى قرص D
rem ROOT FIX 2026-10-02: 20GB كانت تسد قرص C — الملفات المعالجة فقط تُنقل،
rem والبنية تبقى حية على C: لاستقبال الجديد. يعاد تشغيله كل فترة حسب الامتلاء.
robocopy "C:\HorusData\Yarasoft" "D:\KarimArchive\Yarasoft-done-20261002" *.done* /E /MOVE /R:1 /W:2 /NP /NFL /NDL /LOG+:D:\KarimArchive-robocopy-move.log
echo تمريرة ثانية لالتقاط المتأخرات...
robocopy "C:\HorusData\Yarasoft" "D:\KarimArchive\Yarasoft-done-20261002" *.done* /E /MOVE /R:1 /W:2 /NP /NFL /NDL /LOG+:D:\KarimArchive-robocopy-move.log
mkdir "C:\HorusData\Yarasoft\Invoices" 2>nul
mkdir "C:\HorusData\Yarasoft\Invoices_Archive" 2>nul
mkdir "C:\HorusData\Yarasoft\Invoices_Failed" 2>nul
mkdir "C:\HorusData\Yarasoft\Invoices_Processing" 2>nul
mkdir "C:\HorusData\Yarasoft\OraStaging" 2>nul
echo done.
pause
