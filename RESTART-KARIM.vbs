' RESTART-KARIM.vbs — إعادة تشغيل Karim ERP بضغطة واحدة، صفر نوافذ.
' ────────────────────────────────────────────────────────────────────────────
' يُطلق محرك scripts\restart-server.ps1 عبر PowerShell مخفي (window style 0)
' ويقطع ارتباطه فورًا. كل شيء يعمل في الخلفية، والنتيجة تظهر في:
'   logs\restart-status.txt  +  رسالة منبثقة قصيرة (تنغلق تلقائيًا عند النجاح).
' ملاحظة: لا يحتاج صلاحيات أدمن — الإيقاف والقتل مستهدف بعمليات المشروع فقط.
Option Explicit
Dim sh, fso, root
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\restart-server.ps1""", 0, False
Set sh = Nothing
Set fso = Nothing
