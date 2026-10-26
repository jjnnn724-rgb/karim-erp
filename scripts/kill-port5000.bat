@echo off
echo Finding process on port 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 "') do (
    echo PID: %%a
    tasklist /FI "PID eq %%a" /FO CSV 2>nul
)
echo ---
echo Trying to kill...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 "') do (
    echo Killing PID %%a
    taskkill /F /PID %%a 2>nul
)
