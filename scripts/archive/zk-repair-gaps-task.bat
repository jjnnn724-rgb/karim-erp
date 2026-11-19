@echo off
REM Fingerprint audit: heal stuck device punches (raw log committed, write-back failed).
REM Idempotent + fill-only + audited; never touches a row that already has a time.
C:\nodejs\node.exe "%~dp0zk-repair-gaps.js" --apply --days=7 >> "%~dp0..\logs\fingerprint-audit.log" 2>&1
