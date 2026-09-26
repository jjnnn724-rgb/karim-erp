Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""C:\Users\RemoteHome\AppData\Local\hermes\node\node.exe"" ""scripts\serve.js""", 0, False
