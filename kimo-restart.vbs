Dim sh, root
Set sh = CreateObject("WScript.Shell")
root = "C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp"
sh.CurrentDirectory = root
sh.Run "cmd /c node scripts\stop.js", 0, True
WScript.Sleep 2000
sh.Run "cmd /c node scripts\serve.js", 0, False
Set sh = Nothing
