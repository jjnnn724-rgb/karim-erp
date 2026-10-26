# karim ERP — استعادة كاملة على جهاز جديد
# ─────────────────────────────────────────────────────────────
# التشغيل: .\scripts\restore-all.ps1 -ConfirmRestoreDatabase karim_erp [-BackupDir <backup-folder>]
#erequisites: PostgreSQL 18 مثبت + Node.js 20+
# ─────────────────────────────────────────────────────────────
param(
    [Parameter(Mandatory = $true)][string]$ConfirmRestoreDatabase,
    [string]$BackupDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$BACKUP = [IO.Path]::GetFullPath($BackupDir)
$targetDatabase = 'karim_erp'
if ($ConfirmRestoreDatabase -cne $targetDatabase) {
    throw "Restore refused. Re-run with -ConfirmRestoreDatabase $targetDatabase after verifying the target and backup."
}

Write-Host "=== karim ERP Full Restore ===" -ForegroundColor Gold
Write-Host "Package: $BACKUP"
Write-Host ""

# ─── 0. فحص المتطلبات ──────────────────────────────────────────────────────
Write-Host "[0] فحص المتطلبات..." -ForegroundColor Cyan
$pgBin = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (!(Test-Path $pgBin)) { $pgBin = 'C:\Program Files\PostgreSQL\17\bin\psql.exe' }
if (!(Test-Path $pgBin)) { $pgBin = 'C:\Program Files\PostgreSQL\16\bin\psql.exe' }
if (!(Test-Path $pgBin)) { Write-Host "ERROR: PostgreSQL not found!" -ForegroundColor Red; exit 1 }
$pgDir = Split-Path -Parent $pgBin
$pgRestore = Join-Path $pgDir 'pg_restore.exe'
$pgDump = Join-Path $pgDir 'pg_dump.exe'
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (!$nodePath) { Write-Host "ERROR: Node.js not found!" -ForegroundColor Red; exit 1 }
Write-Host "  PostgreSQL: $pgBin" -ForegroundColor Green
Write-Host "  Node.js: $nodePath" -ForegroundColor Green
$runningServices = @(Get-Service -Name @('KarimERP-Server', 'AlShorfaERP', 'KarimERP-PrintWorker', 'AlShorfaPrintWorker') -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Running' })
if ($runningServices.Count) { throw 'Karim ERP services are running. Stop them before restoring any database.' }
$tcpConnectionCommand = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
if (!$tcpConnectionCommand) { throw 'Cannot verify whether the ERP port is in use; restore aborted.' }
$erpListener = Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue
if ($erpListener) { throw 'Port 5000 has an active listener. Stop the application before restoring.' }

$dumpCandidates = @()
$legacyDump = Join-Path $BACKUP 'karim_erp.dump'
if (Test-Path $legacyDump) { $dumpCandidates += Get-Item $legacyDump }
$databaseDir = Join-Path $BACKUP 'database'
if (Test-Path $databaseDir) {
    $dumpCandidates += Get-ChildItem $databaseDir -File -Filter 'karim_erp_*.dump' |
        Where-Object { $_.Name -notlike '*.sha256' }
}
$dumpFile = $dumpCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (!$dumpFile) {
    $updateDump = Join-Path $BACKUP 'karim.dump'
    if (Test-Path $updateDump) { $dumpFile = $updateDump }
}
if (!$dumpFile) { throw "No PostgreSQL dump found in $BACKUP — restore aborted before changing the database." }
if (!(Test-Path $pgRestore)) { throw 'pg_restore.exe not found — restore aborted.' }
& $pgRestore --list $dumpFile *> $null
if ($LASTEXITCODE -ne 0) { throw 'Backup archive verification failed — restore aborted before changing the database.' }

if (-not $env:PGPASSWORD) {
    $securePassword = Read-Host 'PostgreSQL password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}

# ─── 1. إنشاء قاعدة البيانات ───────────────────────────────────────────────
Write-Host "[1] إنشاء قاعدة البيانات..." -ForegroundColor Cyan
$dbExists = & $pgBin -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname='$targetDatabase'" 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Could not check target database existence — restore aborted.' }
if ($dbExists.Trim() -eq '0') {
    & $pgBin -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $targetDatabase OWNER postgres" 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Could not create target database — restore aborted.' }
    Write-Host "  Database created" -ForegroundColor Green
} else {
    if (!(Test-Path $pgDump)) { throw 'Existing database detected but pg_dump.exe is unavailable; refusing to overwrite without a pre-restore backup.' }
    $preRestoreDir = Join-Path 'C:\KarimData\backups' ("pre-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $preRestoreDir | Out-Null
    $preRestoreDump = Join-Path $preRestoreDir "$targetDatabase.dump"
    & $pgDump -h 127.0.0.1 -U postgres -Fc --no-owner --no-privileges -f $preRestoreDump $targetDatabase
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $preRestoreDump) -or (Get-Item $preRestoreDump).Length -eq 0) {
        throw 'Pre-restore database backup failed; target database was not changed.'
    }
    & $pgRestore --list $preRestoreDump *> $null
    if ($LASTEXITCODE -ne 0) { throw "Pre-restore backup verification failed; target database was not changed. Backup: $preRestoreDump" }
    Write-Host "  Existing database backed up to $preRestoreDump" -ForegroundColor Yellow
}

# ─── 2. استعادة قاعدة البيانات ──────────────────────────────────────────────
Write-Host "[2] استعادة قاعدة البيانات..." -ForegroundColor Cyan
& $pgRestore -h 127.0.0.1 -U postgres -d $targetDatabase --clean --if-exists --no-owner --no-acl $dumpFile 2>&1
if ($LASTEXITCODE -ne 0) { throw "Restore failed. Do not start the application; preserve the pre-restore backup for recovery." }
Write-Host "  Restore command completed successfully" -ForegroundColor Green

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
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; do not start the application.' }
} elseif (Test-Path 'package.json') {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed; do not start the application.' }
} else {
    throw 'package.json is missing; dependencies cannot be restored.'
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
$winsw = 'C:\KarimData\bin\WinSW.NET461.exe'
if (Test-Path $winsw) {
    & $winsw install
    if ($LASTEXITCODE -ne 0) { throw 'WinSW service registration failed.' }
    Write-Host "  WinSW service registered" -ForegroundColor Green
} else {
    Write-Host "  WinSW not found — register services manually" -ForegroundColor Yellow
}

# ─── 9. تشغيل السيرفر ──────────────────────────────────────────────────────
Write-Host "[9] تشغيل السيرفر..." -ForegroundColor Cyan
schtasks /Run /TN "KarimERP-Server"
if ($LASTEXITCODE -ne 0) { throw 'Could not start the KarimERP-Server scheduled task.' }
Start-Sleep -Seconds 10
$healthy = $false
foreach ($scheme in @('https', 'http')) {
    $health = curl.exe --silent --show-error --fail --max-time 5 "${scheme}://127.0.0.1:5000/api/health" 2>$null
    if ($LASTEXITCODE -eq 0 -and $health -match '"status"\s*:\s*"ok"') {
        $healthy = $true
        break
    }
}
if ($healthy) {
    Write-Host "  Server running!" -ForegroundColor Green
} else {
    throw 'Health check failed after restore; restore is not complete and the application must not be treated as ready.'
}

# ─── ملخص ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== الاستعادة مكتملة ===" -ForegroundColor Green
Write-Host ""
Write-Host "بيانات الدخول:" -ForegroundColor Yellow
Write-Host "  استخدم حسابًا قائمًا تم التحقق منه أو أنشئ بيانات اعتماد آمنة عبر إجراء تهيئة موثق."
Write-Host ""
Write-Host "الرابط:" -ForegroundColor Yellow
Write-Host "  https://192.168.1.165:5000"
Write-Host "  http://localhost:5000"
