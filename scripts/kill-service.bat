@echo off
echo Finding HorusERP service processes...
for /f "tokens=2" %%a in ('sc query HorusERP-Server ^| findstr "SERVICE_PID"') do (
    set SERVICE_PID=%%a
)
if defined SERVICE_PID (
    echo Service PID: %SERVICE_PID%
    taskkill /F /PID %SERVICE_PID% 2>&1
) else (
    echo Service PID not found via sc query
)
