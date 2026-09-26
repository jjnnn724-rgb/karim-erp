# karim ERP - Full Backup & Archive
# Creates: fresh DB dump + code + .env + SSL certs + Yarasoft data
# Output: C:\KarimData\backups\karim_FULL_YYYY-MM-DD_HHmmss\ + .zip
# Schedule: KarimERP-Backup runs daily at 2:00 AM

$ErrorActionPreference = 'Stop'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TS = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$BACKUP_BASE = 'C:\KarimData\backups'
$BACKUP = Join-Path $BACKUP_BASE "karim_FULL_$TS"

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '   karim ERP - Full Backup & Archive' -ForegroundColor DarkCyan
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''

# [1] PostgreSQL dump (fresh)
Write-Host "[1/7] Creating fresh PostgreSQL dump..." -ForegroundColor Yellow
$env:PGPASSWORD = 'Kimo20177'
$pgBin = ''
$pgPaths = @('C:\Program Files\PostgreSQL\18\bin','C:\Program Files\PostgreSQL\17\bin','C:\Program Files\PostgreSQL\16\bin')
foreach($p in $pgPaths) { if(Test-Path (Join-Path $p 'pg_dump.exe')) { $pgBin = $p; break } }
if(!$pgBin) { Write-Host '  pg_dump.exe not found - skipping DB dump' -ForegroundColor Red }
else {
    $dumpDir = Join-Path $BACKUP 'database'
    New-Item -ItemType Directory -Path $dumpDir -Force | Out-Null
    $dumpFile = Join-Path $dumpDir "karim_erp_$TS.dump"
    $sqlFile  = Join-Path $dumpDir "karim_erp_$TS.sql"

    Write-Host "  pg_dump (custom format)..."
    & "$pgBin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -Fc -Z9 --no-owner --no-privileges -f $dumpFile karim_erp 2>&1 | Out-Null
    if($LASTEXITCODE -eq 0) {
        $dumpMB = [math]::Round((Get-Item $dumpFile).Length / 1MB, 1)
        Write-Host "  Dump OK: $dumpMB MB" -ForegroundColor Green
    } else {
        Write-Host "  pg_dump failed (exit $LASTEXITCODE) - SQL fallback..." -ForegroundColor Yellow
        & "$pgBin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres --no-owner --no-privileges karim_erp > $sqlFile 2>&1
    }

    # Save row counts for verification
    $countFile = Join-Path $dumpDir "row_counts_$TS.txt"
    Write-Host "  Saving row counts..."
    $ErrorActionBak = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $r = & "$pgBin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d karim_erp -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" 2>&1
        $tables = ($r | Out-String) -split "`n" | Where-Object { $_.Trim() -ne '' -and $_.Trim() -notmatch '^ERROR' }
        $counts = @()
        foreach($t in $tables) {
            $t = $t.Trim()
            if($t -eq '' -or $t -match '^ERROR') { continue }
            $sql = 'SELECT COUNT(*) FROM "' + $t + '";'
            $r2 = & "$pgBin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d karim_erp -t -A -c $sql 2>&1
            $cnt = ($r2 | Out-String).Trim()
            if($cnt -match '^\d+$') { $counts += "$t : $cnt" }
        }
        $counts | Out-File -FilePath $countFile -Encoding UTF8
        Write-Host "  Row counts saved ($($counts.Count) tables)" -ForegroundColor Green
    } catch {
        Write-Host "  Row counts skipped: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    $ErrorActionPreference = $ErrorActionBak
}

# [2] Code
Write-Host "[2/7] Copying code..." -ForegroundColor Yellow
$codeDst = Join-Path $BACKUP 'karim-erp'
robocopy $ROOT $codeDst /E /XD node_modules logs .opencode "database/backups" __pycache__ /NFL /NDL /NJH /NJS /NC /NS /NP /R:0 /W:0 | Out-Null
Write-Host "  Code copied" -ForegroundColor Green

# [3] .env
Write-Host "[3/7] Copying .env..." -ForegroundColor Yellow
$envSrc = Join-Path $ROOT '.env'
$envDst = Join-Path $BACKUP '.env'
if(Test-Path $envSrc) { Copy-Item $envSrc $envDst -Force }
# Sanitized copy (no secrets)
$envSafe = Join-Path $BACKUP '.env.example'
$lines = Get-Content $envDst
$safe = $lines | ForEach-Object {
    if($_ -match '^\s*(JWT_|EMPLOYEE_QR_SECRET|DB_PASSWORD|YARASOFT_ORACLE_PASSWORD)\s*=') {
        $_ -replace '=.*', '=REDACTED'
    } else { $_ }
}
$safe | Out-File -FilePath $envSafe -Encoding UTF8
Write-Host "  .env + .env.example saved" -ForegroundColor Green

# [4] SSL Certs
Write-Host "[4/7] Copying SSL certificates..." -ForegroundColor Yellow
$certSrc = 'C:\KarimData\certs'
$certDst = Join-Path $BACKUP 'certs'
if(Test-Path $certSrc) { Copy-Item $certSrc $certDst -Recurse -Force }
$caPath = Join-Path ([System.Environment]::GetFolderPath('Desktop')) 'Karim-CA.crt'
if(Test-Path $caPath) { Copy-Item $caPath (Join-Path $BACKUP 'Karim-CA.crt') -Force }
Write-Host "  Certs copied" -ForegroundColor Green

# [5] Yarasoft / PrintTemplates
Write-Host "[5/7] Copying Yarasoft data..." -ForegroundColor Yellow
$ysSrc = 'C:\KarimData\Yarasoft'
if(Test-Path $ysSrc) { Copy-Item $ysSrc (Join-Path $BACKUP 'Yarasoft') -Recurse -Force -ErrorAction SilentlyContinue }
$ptSrc = 'C:\KarimData\PrintTemplates'
if(Test-Path $ptSrc) { Copy-Item $ptSrc (Join-Path $BACKUP 'PrintTemplates') -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "  Data copied" -ForegroundColor Green

# [6] System info
Write-Host "[6/7] Exporting system info..." -ForegroundColor Yellow
$tasksDir = Join-Path $BACKUP 'system-info'
New-Item -ItemType Directory -Path $tasksDir -Force | Out-Null
try { schtasks /Query /FO CSV 2>&1 | Out-String | Out-File (Join-Path $tasksDir 'scheduled-tasks.csv') -Encoding UTF8 } catch {}
try { Get-Service -Name 'KarimERP*' -ErrorAction SilentlyContinue | Format-Table Name,Status,StartType -AutoSize | Out-String | Out-File (Join-Path $tasksDir 'services.txt') -Encoding UTF8 } catch {}
try { ipconfig /all | Out-String | Out-File (Join-Path $tasksDir 'network.txt') -Encoding UTF8 } catch {}
Write-Host "  System info saved" -ForegroundColor Green

# [7] ZIP archive
Write-Host "[7/7] Creating ZIP archive..." -ForegroundColor Yellow
$zipPath = "$BACKUP.zip"
$zipOK = $false
try {
    Compress-Archive -Path $BACKUP -DestinationPath $zipPath -CompressionLevel Optimal -Force
    $zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  ZIP created: $zipMB MB" -ForegroundColor Green
    $zipOK = $true
} catch {
    Write-Host "  ZIP failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Cleanup old backups (keep last 14)
Write-Host ''
Write-Host 'Cleaning old backups (keeping last 14)...' -ForegroundColor Gray
$oldBackups = Get-ChildItem $BACKUP_BASE -Directory | Where-Object { $_.Name -like 'karim_FULL_*' } | Sort-Object Name
if($oldBackups.Count -gt 14) {
    $toDelete = $oldBackups | Select-Object -Last ($oldBackups.Count - 14)
    foreach($d in $toDelete) {
        Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
        $zipOld = "$($d.FullName).zip"
        if(Test-Path $zipOld) { Remove-Item $zipOld -Force -ErrorAction SilentlyContinue }
        Write-Host "  Removed: $($d.Name)" -ForegroundColor DarkGray
    }
}

# Summary
$sz = (Get-ChildItem $BACKUP -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host ('  Backup Complete: {0} MB' -f [math]::Round($sz/1MB,1)) -ForegroundColor Green
Write-Host ('  Folder: {0}' -f $BACKUP) -ForegroundColor Green
if($zipOK) { Write-Host ('  ZIP:    {0}' -f $zipPath) -ForegroundColor Green }
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host 'To restore on a new machine:' -ForegroundColor Yellow
Write-Host '  1. Extract this folder next to karim-erp code' -ForegroundColor White
Write-Host '  2. Run: .\scripts\restore-all.ps1' -ForegroundColor White
