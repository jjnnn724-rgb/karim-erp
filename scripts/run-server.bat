@echo off
:: Horus ERP v4.7.0 — Server Runner (background)
:: Port 5001 — run-server.bat launches node, startup.bat monitors & restarts

set "PORT=5001"
set "NODE_EXE=C:\Users\RemoteHome\AppData\Local\hermes\node\node.exe"
set "PROJECT_DIR=C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp"
cd /d "%PROJECT_DIR%"
start /B "" "%NODE_EXE%" backend\server.js
