@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000"') do (
    echo PID: %%a
    tasklist /FI "PID eq %%a" 2>nul | findstr "node.exe"
)
