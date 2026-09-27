' Karim ERP - Hidden Start. Double click: no window at all.
' Server logs: logs\serve-hidden.log | Stop: STOP-KARIM.vbs
Option Explicit
Dim sh, fso, root, logFile, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
If Not fso.FolderExists(root & "\logs") Then fso.CreateFolder(root & "\logs")
logFile = root & "\logs\serve-hidden.log"
cmd = "cmd /c node scripts\serve.js >> """ & logFile & """ 2>&1"
sh.Run cmd, 0, False
Set sh = Nothing
Set fso = Nothing
