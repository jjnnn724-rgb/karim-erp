@echo off
REM Karim ERP - zrok public share launcher - run by scheduled task as SYSTEM
REM Identity lives in RemoteHome profile, so point USERPROFILE there.
REM Task -Admin once-:
REM   schtasks /create /tn "KarimERP-Zrok" /tr "'C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp\scripts\zrok-share.bat'" /sc onstart /ru SYSTEM /f
setlocal EnableExtensions
set "USERPROFILE=C:\Users\RemoteHome"
set "HOMEDRIVE=C:"
set "HOMEPATH=\Users\RemoteHome"
>> "C:\KarimData\zrok-share.log" 2>&1 (
  echo [%date% %time%] zrok share starting...
  C:\KarimTools\zrok\zrok.exe share public --backend-mode proxy --insecure --headless -n public:karim-erp https://127.0.0.1:5001
)
