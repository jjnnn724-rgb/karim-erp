@echo off
cd /d "C:\Users\RemoteHome\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\horus-erp"
set LT_BASE=https://localhost:5001
set LT_ADMIN_PASS=Admin#2026#Karim
set NODE_TLS_REJECT_UNAUTHORIZED=0
set LT_CONC=30
node scripts/load_test.js
