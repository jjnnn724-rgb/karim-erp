' Karim ERP - Hidden Stop. Stops the server, no console window.
Option Explicit
Dim sh, fso, root
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Run "cmd /c node scripts\stop.js", 0, True
MsgBox "Karim ERP stopped.", 64, "Karim ERP"
Set sh = Nothing
Set fso = Nothing
