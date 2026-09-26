# karim ERP — استعادة كاملة على جهاز جديد
# ─────────────────────────────────────────────────────────────
# التشغيل: شغّل هذا السكريبت في نفس مجلد karim ERP
#erequisites: PostgreSQL 18 مثبت + Node.js 18+
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKUP = Split-Path -Parent $ROOT
if (!(Test-Path (Join-Path $BACKUP 'karim_erp.dump'))) {
    # Try looking in parent for DeploymentPackage
    $BACKUP = (Get-Item $ROOT).Parent.FullName
}

Write-Host "=== karim ERP Full Restore ===" -ForegroundColor Gold
Write-Host "Package: $BACKUP"
Write-Host ""

# ─── 0. فحص المتطلبات ──────────────────────────────────────────────────────
Write-Host "[0] فحص المتطلبات..." -ForegroundColor Cyan
$pgBin = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (!(Test-Path $pgBin)) { $pgBin = 'C:\Program Files\PostgreSQL\17\bin\psql.exe' }
if (!(Test-Path $pgBin)) { Write-Host "ERROR: PostgreSQL not found!" -ForegroundColor Red; exit 1 }
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (!$nodePath) { Write-Host "ERROR: Node.js not found!" -ForegroundColor Red; exit 1 }
Write-Host "  PostgreSQL: $pgBin" -ForegroundColor Green
Write-Host "  Node.js: $nodePath" -ForegroundColor Green

# ─── 1. إنشاء قاعدة البيانات ───────────────────────────────────────────────
Write-Host "[1] إنشاء قاعدة البيانات..." -ForegroundColor Cyan
$env:PGPASSWORD = 'Kimo20177'
& $pgBin -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='karim_erp'" | Out-Null
$dbExists = & $pgBin -h 127.0.0.1 -U postgres -tc "SELECT count(*) FROM pg_database WHERE datname='karim_erp'" 2>&1
if ($dbExists.Trim() -eq '0') {
    & $pgBin -h 127.0.0.1 -U postgres -c "CREATE DATABASE karim_erp OWNER postgres" 2>&1
    Write-Host "  Database created" -ForegroundColor Green
} else {
    Write-Host "  Database exists (will restore over it)" -ForegroundColor Yellow
}

# ─── 2. استعادة قاعدة البيانات ──────────────────────────────────────────────
Write-Host "[2] استعادة قاعدة البيانات..." -ForegroundColor Cyan
$dumpFile = Join-Path $BACKUP 'karim_erp.dump'
if (Test-Path $dumpFile) {
    $pgRestore = $pgBin -replace 'psql.exe','pg_restore.exe'
    & $pgRestore -h 127.0.0.1 -U postgres -d karim_erp --no-owner --no-acl -Fc $dumpFile 2>&1
    Write-Host "  Restore complete" -ForegroundColor Green
} else {
    Write-Host "  WARNING: No dump file found at $dumpFile" -ForegroundColor Yellow
}

# ─── 3. نسخ .env ────────────────────────────────────────────────────────────
Write-Host "[3] نسخ ملفات الإعدادات..." -ForegroundColor Cyan
$envSrc = Join-Path $BACKUP '.env'
$envDst = Join-Path $ROOT '.env'
if (Test-Path $envSrc) {
    Copy-Item $envSrc $envDst -Force
    Write-Host "  .env copied" -ForegroundColor Green
}

# ─── 4. نسخ شهادات SSL ──────────────────────────────────────────────────────
Write-Host "[4] نسخ شهادات SSL..." -ForegroundColor Cyan
$certSrc = Join-Path $BACKUP 'certs'
$certDst = 'C:\KarimData\certs'
if (Test-Path $certSrc) {
    New-Item -ItemType Directory -Path $certDst -Force | Out-Null
    Copy-Item $certSrc $certDst -Recurse -Force
    Write-Host "  SSL certs copied to $certDst" -ForegroundColor Green
}

# ─── 5. نسخ ملفات Yarasoft ──────────────────────────────────────────────────
Write-Host "[5] نسخ ملفات Yarasoft..." -ForegroundColor Cyan
$ysSrc = Join-Path $BACKUP 'Yarasoft'
$ysDst = 'C:\KarimData\Yarasoft'
if (Test-Path $ysSrc) {
    New-Item -ItemType Directory -Path $ysDst -Force | Out-Null
    Copy-Item $ysSrc $ysDst -Recurse -Force
    Write-Host "  Yarasoft files copied" -ForegroundColor Green
}

# ─── 6. تثبيت المكتبات ─────────────────────────────────────────────────────
Write-Host "[6] تثبيت npm packages..." -ForegroundColor Cyan
Push-Location $ROOT
if (Test-Path 'package-lock.json') {
    npm ci 2>&1 | Out-Null
} elseif (Test-Path 'package.json') {
    npm install 2>&1 | Out-Null
}
Pop-Location
Write-Host "  npm install done" -ForegroundColor Green

# ─── 7. تثبيت oracledb + Instant Client (اختياري) ──────────────────────────
Write-Host "[7] فحص Oracle Instant Client..." -ForegroundColor Cyan
$icPath = 'C:\oracle\instantclient_23_26'
if (Test-Path $icPath) {
    Write-Host "  Oracle IC found at $icPath" -ForegroundColor Green
} else {
    Write-Host "  Oracle IC not found — Oracle sync will be disabled" -ForegroundColor Yellow
}

# ─── 8. تسجيل خدمات Windows ────────────────────────────────────────────────
Write-Host "[8] تسجيل خدمات Windows..." -ForegroundColor Cyan
$winsw = Join-Path $ROOT 'C:\KarimData\bin\WinSW.NET461.exe'
if (Test-Path $winsw) {
    & $winsw install 2>&1 | Out-Null
    Write-Host "  WinSW service registered" -ForegroundColor Green
} else {
    Write-Host "  WinSW not found — register services manually" -ForegroundColor Yellow
}

# ─── 9. تشغيل السيرفر ──────────────────────────────────────────────────────
Write-Host "[9] تشغيل السيرفر..." -ForegroundColor Cyan
schtasks /Run /TN "KarimERP-Server" 2>&1 | Out-Null
Start-Sleep -Seconds 10
$health = curl.exe -k -s -m 5 https://127.0.0.1:5000/api/health 2>&1
if ($health -match '"status":"ok"') {
    Write-Host "  Server running!" -ForegroundColor Green
} else {
    Write-Host "  Server starting... (may take 15-30 seconds)" -ForegroundColor Yellow
}

# ─── ملخص ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== الاستعادة مكتملة ===" -ForegroundColor Green
Write-Host ""
Write-Host "بيانات الدخول:" -ForegroundColor Yellow
Write-Host "  admin / admin12345"
Write-Host "  admin1 / 123456"
Write-Host ""
Write-Host "الرابط:" -ForegroundColor Yellow
Write-Host "  https://192.168.1.165:5000"
Write-Host "  http://localhost:5000"
