@echo off
C:\nodejs\node.exe "%~dp0backup-nightly.js" >> "%~dp0..\database\backups\nightly-task.log" 2>&1
