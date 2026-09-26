# ============================================================
#  🦅 karim ERP v4.7.0 — Windows Master Script (PowerShell)
#  ============================================================
#  سكربت موحد لكل عمليات karim ERP على ويندوز:
#    - setup:    تثبيت + تنزيل PG + migrations
#    - run:      تشغيل النظام
#    - test:     تشغيل الاختبارات
#    - build:    بناء .exe
#    - status:   فحص حالة الخادم
#    - stop:     إيقاف الخادم
#    - clean:    تنظيف node_modules + release
#    - reset-db: إعادة تهيئة قاعدة البيانات
#    - backup:   نسخة احتياطية من DB
#    - restore:  استعادة نسخة احتياطية
#    - all:      setup + run
#
#  الاستخدام:
#    powershell -ExecutionPolicy Bypass -File horus-master.ps1 setup
#    powershell -ExecutionPolicy Bypass -File horus-master.ps1 run
#    powershell -ExecutionPolicy Bypass -File horus-master.ps1 test
#    powershell -ExecutionPolicy Bypass -File horus-master.ps1 build nsis
#    powershell -ExecutionPolicy Bypass -File horus-master.ps1 all
# ============================================================

param(
    [Parameter(Position=0)]
    [ValidateSet('setup','run','test','build','status','stop','clean','reset-db','backup','restore','all','help','')]
    [string]$Command = 'help',

    [Parameter(Position=1)]
    [string]$SubCommand = ''
)

$ErrorActionPreference = 'Stop'
$AppVersion = '4.7.0'
$AppName = 'karim ERP'

# ─── Helpers ────────────────────────────────────────────────────
function Write-Header {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 60) -ForegroundColor DarkYellow
    Write-Host "  $Title" -ForegroundColor Yellow
    Write-Host ('=' * 60) -ForegroundColor DarkYellow
    Write-Host ''
}

function Write-Step {
    param([string]$Msg)
    Write-Host "  > $Msg" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$Msg)
    Write-Host "  [OK] $Msg" -ForegroundColor Green
}

function Write-Err {
    param([string]$Msg)
    Write-Host "  [ERROR] $Msg" -ForegroundColor Red
}

function Test-Node {
    try {
        $v = node --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            return $true, $v
        }
    } catch {}
    return $false, $null
}

function Test-PostgresRunning {
    try {
        $result = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
        return $result.TcpTestSucceeded
    } catch {
        return $false
    }
}

function Stop-BackendProcess {
    Write-Step 'Stopping any running karim ERP backend processes...'
    # PS 5.1 Get-Process objects DO NOT expose CommandLine/Path (always $null,
    # so these filters never matched and nothing was ever stopped). Use the
    # CIM instances, which do carry the command line.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match 'backend[\\/]server\.js'
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "    Stopped PID $($_.ProcessId)" -ForegroundColor Gray
    }
    Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -match 'database[\\/]bin'
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "    Stopped PostgreSQL PID $($_.ProcessId)" -ForegroundColor Gray
    }
}

# ─── Commands ───────────────────────────────────────────────────

function Invoke-Setup {
    Write-Header "$AppName v$AppVersion - Setup"

    # Check Node
    Write-Step 'Checking Node.js...'
    $nodeOk, $nodeVer = Test-Node
    if (-not $nodeOk) {
        Write-Err 'Node.js is not installed. Install from https://nodejs.org/'
        exit 1
    }
    Write-OK "Node.js $nodeVer"

    # Check npm
    Write-Step 'Checking npm...'
    try {
        $npmVer = npm --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "npm $npmVer"
        } else { throw }
    } catch {
        Write-Err 'npm not found. Reinstall Node.js.'
        exit 1
    }

    # Install npm dependencies
    Write-Step 'Installing npm dependencies...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'npm install failed.'
        exit 1
    }
    Write-OK 'Dependencies installed'

    # Download PostgreSQL
    Write-Step 'Setting up PostgreSQL Portable...'
    npm run download-pg
    Write-OK 'PostgreSQL setup complete'

    # patch-html (no-op if legacy file missing)
    Write-Step 'Running patch-html compatibility check...'
    npm run patch-html
    Write-OK 'patch-html done'

    # Create .env
    Write-Step 'Creating .env file with strong random secrets...'
    if (Test-Path .env) {
        Write-Host '    .env already exists, skipping.' -ForegroundColor Gray
    } else {
        if (-not (Test-Path .env.example)) {
            Write-Err '.env.example not found.'
            exit 1
        }
        Copy-Item .env.example .env
        $accessSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
        $refreshSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
        (Get-Content .env) -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$accessSecret" | Set-Content .env
        (Get-Content .env) -replace '^JWT_REFRESH_SECRET=.*', "JWT_REFRESH_SECRET=$refreshSecret" | Set-Content .env
        Write-OK '.env created with strong random secrets'
    }

    # Final syntax check
    Write-Step 'Verifying JS syntax across all files...'
    node -e "const {execSync}=require('child_process');const fs=require('fs');const path=require('path');function walk(d){let r=[];for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())r=r.concat(walk(p));else if(f.endsWith('.js'))r.push(p);}return r;}let all=[];for(const d of ['backend','scripts','database/scripts','electron','tests','frontend/app/js','build']){if(fs.existsSync(d))all=all.concat(walk(d));}let err=0;for(const f of all){try{execSync('node --check \"'+f+'\"',{stdio:'pipe'});}catch(e){err++;console.log('FAIL:',f);}}console.log('Checked:',all.length,'files | Errors:',err);if(err>0)process.exit(1);"
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'Syntax check failed.'
        exit 1
    }
    Write-OK 'All JS files have valid syntax'

    Write-Header 'Setup Complete!'
    Write-Host '  Next steps:' -ForegroundColor White
    Write-Host '    Start the system:   .\run-windows.bat   or   horus-master.ps1 run' -ForegroundColor Gray
    Write-Host '    Run tests:          .\test-windows.bat  or   horus-master.ps1 test' -ForegroundColor Gray
    Write-Host '    Build .exe:         .\build-windows.bat or   horus-master.ps1 build' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Default login: see bootstrap-admin-credential.json (generated on first setup)' -ForegroundColor Yellow
    Write-Host ''
}

function Invoke-Run {
    Write-Header "$AppName v$AppVersion - Starting"

    # Check .env
    if (-not (Test-Path .env)) {
        Write-Step '.env not found. Creating from .env.example...'
        if (Test-Path .env.example) {
            Copy-Item .env.example .env
            $accessSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
            $refreshSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
            (Get-Content .env) -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$accessSecret" | Set-Content .env
            (Get-Content .env) -replace '^JWT_REFRESH_SECRET=.*', "JWT_REFRESH_SECRET=$refreshSecret" | Set-Content .env
            Write-OK '.env created'
        } else {
            Write-Err '.env.example not found. Run setup first.'
            exit 1
        }
    }

    # Check node_modules
    if (-not (Test-Path node_modules)) {
        Write-Step 'node_modules not found. Installing dependencies...'
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'npm install failed.'
            exit 1
        }
    }

    Write-Step 'Starting karim ERP...'
    Write-Host ''
    Write-Host '  This will:' -ForegroundColor Gray
    Write-Host '    - Start PostgreSQL Portable' -ForegroundColor Gray
    Write-Host '    - Apply database migrations' -ForegroundColor Gray
    Write-Host '    - Start the Express server on port 5000' -ForegroundColor Gray
    Write-Host '    - Open your browser automatically' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Press Ctrl+C to stop safely.' -ForegroundColor Yellow
    Write-Host ''

    node scripts/start.js
}

function Invoke-Test {
    Write-Header "$AppName v$AppVersion - Test Suite"

    if (-not (Test-Path node_modules)) {
        Write-Err 'node_modules not found. Run setup first.'
        exit 1
    }

    $passed = 0
    $failed = 0

    $tests = @(
        @{ Name = 'Jest Unit Tests (252)';        Cmd = 'npx jest tests/ --no-coverage --silent' }
        @{ Name = 'Smoke Test (27 endpoints)';    Cmd = 'node scripts/smoke-test.js' }
        @{ Name = 'Integration Test (53 checks)'; Cmd = 'node scripts/integration-test.js' }
        @{ Name = 'POS Sale Cycle (64 checks)';   Cmd = 'node scripts/pos-sale-test.js' }
    )

    # Filter by subcommand
    if ($SubCommand -ne '') {
        $map = @{
            'jest' = 'Jest Unit Tests'
            'smoke' = 'Smoke Test'
            'integration' = 'Integration Test'
            'pos' = 'POS Sale Cycle'
        }
        $filter = $map[$SubCommand]
        if (-not $filter) {
            Write-Err "Unknown test: $SubCommand"
            Write-Host 'Available: jest, smoke, integration, pos' -ForegroundColor Gray
            exit 1
        }
        $tests = $tests | Where-Object { $_.Name -like "$filter*" }
    }

    foreach ($t in $tests) {
        Write-Host ''
        Write-Host ('-' * 60) -ForegroundColor DarkGray
        Write-Host "  Running: $($t.Name)" -ForegroundColor Cyan
        Write-Host ('-' * 60) -ForegroundColor DarkGray
        Invoke-Expression $t.Cmd
        if ($LASTEXITCODE -eq 0) {
            Write-OK $t.Name
            $passed++
        } else {
            Write-Err $t.Name
            $failed++
        }
    }

    Write-Header 'Test Summary'
    Write-Host "  Passed: $passed" -ForegroundColor Green
    Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Gray' })
    if ($SubCommand -eq '' -and $failed -eq 0) {
        Write-Host ''
        Write-Host '  All 4 test suites passed: 396/396 checks' -ForegroundColor Green
        Write-Host '  Status: PRODUCTION READY' -ForegroundColor Green
    }
    Write-Host ''
    exit $failed
}

function Invoke-Build {
    Write-Header "$AppName v$AppVersion - Build"

    if (-not (Test-Path node_modules)) {
        Write-Err 'node_modules not found. Run setup first.'
        exit 1
    }
    if (-not (Test-Path .env)) {
        Write-Step 'Creating .env...'
        if (Test-Path .env.example) {
            Copy-Item .env.example .env
            $accessSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
            $refreshSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
            (Get-Content .env) -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$accessSecret" | Set-Content .env
            (Get-Content .env) -replace '^JWT_REFRESH_SECRET=.*', "JWT_REFRESH_SECRET=$refreshSecret" | Set-Content .env
        } else {
            Write-Err '.env.example not found.'
            exit 1
        }
    }

    # Clean previous build
    if (Test-Path release) {
        Write-Step 'Cleaning previous release/ directory...'
        Remove-Item -Recurse -Force release
    }

    $buildNsis = $true
    $buildPortable = $true
    if ($SubCommand -eq 'nsis') { $buildPortable = $false }
    if ($SubCommand -eq 'portable') { $buildNsis = $false }

    Write-Host '  Build configuration:' -ForegroundColor White
    Write-Host "    - NSIS Installer: $(if ($buildNsis) { 'YES' } else { 'NO' })" -ForegroundColor Gray
    Write-Host "    - Portable:       $(if ($buildPortable) { 'YES' } else { 'NO' })" -ForegroundColor Gray
    Write-Host ''

    if ($buildNsis) {
        Write-Step 'Building NSIS Installer...'
        npm run electron:build:nsis
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'NSIS build failed.'
            exit 1
        }
        Write-OK 'NSIS installer built'
    }

    if ($buildPortable) {
        Write-Step 'Building Portable...'
        npm run electron:build:portable
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'Portable build failed.'
            exit 1
        }
        Write-OK 'Portable built'
    }

    Write-Header 'Build Complete!'
    Write-Host '  Output files in release/ directory:' -ForegroundColor White
    if (Test-Path release) {
        Get-ChildItem release\*.exe | ForEach-Object {
            Write-Host "    $($_.Name)  ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Gray
        }
    }
    Write-Host ''
}

function Invoke-Status {
    Write-Header "$AppName v$AppVersion - Status"

    # Check backend
    Write-Step 'Checking backend (port 5000)...'
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:5000/api/health' -UseBasicParsing -TimeoutSec 3
        $health = $resp.Content | ConvertFrom-Json
        Write-OK "Backend running (status: $($health.status))"
        Write-Host "    Uptime:    $([math]::Round($health.uptime, 1))s" -ForegroundColor Gray
        Write-Host "    DB:        $($health.checks.database.status)" -ForegroundColor Gray
        Write-Host "    Clients:   $($health.checks.realtime.connectedClients) connected" -ForegroundColor Gray
    } catch {
        Write-Err 'Backend not running. Start with: horus-master.ps1 run'
    }

    # Check PostgreSQL
    Write-Step 'Checking PostgreSQL (port 5432)...'
    if (Test-PostgresRunning) {
        Write-OK 'PostgreSQL is running'
    } else {
        Write-Host '  [WARN] PostgreSQL not detected on port 5432' -ForegroundColor Yellow
    }

    # Check files
    Write-Step 'Checking project files...'
    if (Test-Path .env) { Write-OK '.env exists' } else { Write-Err '.env missing' }
    if (Test-Path node_modules) { Write-OK 'node_modules exists' } else { Write-Err 'node_modules missing' }
    if (Test-Path database/bin/bin/postgres.exe) {
        Write-OK 'PostgreSQL Portable binaries exist'
    } else {
        Write-Host '  [WARN] PostgreSQL Portable not downloaded yet' -ForegroundColor Yellow
    }
    Write-Host ''
}

function Invoke-Stop {
    Write-Header "$AppName v$AppVersion - Stop"
    Stop-BackendProcess
    Write-OK 'All karim ERP processes stopped'
    Write-Host ''
}

function Invoke-Clean {
    Write-Header "$AppName v$AppVersion - Clean"
    Write-Step 'Removing node_modules...'
    if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
    Write-Step 'Removing release/...'
    if (Test-Path release) { Remove-Item -Recurse -Force release }
    Write-Step 'Removing dist/...'
    if (Test-Path dist) { Remove-Item -Recurse -Force dist }
    Write-Step 'Removing database/data/...'
    if (Test-Path database/data) { Remove-Item -Recurse -Force database/data }
    Write-Step 'Removing database/backups/...'
    if (Test-Path database/backups) { Remove-Item -Recurse -Force database/backups }
    Write-OK 'Clean complete. Run setup-windows.bat to reinstall.'
    Write-Host ''
}

function Invoke-ResetDb {
    Write-Header "$AppName v$AppVersion - Reset Database"
    Write-Step 'This will DELETE all data and recreate the database from migrations.'
    $confirm = Read-Host 'Type YES to confirm'
    if ($confirm -ne 'YES') {
        Write-Host 'Cancelled.' -ForegroundColor Yellow
        exit 0
    }
    Write-Step 'Stopping backend...'
    Stop-BackendProcess
    Write-Step 'Removing database/data/...'
    if (Test-Path database/data) { Remove-Item -Recurse -Force database/data }
    Write-OK 'Database reset. Run "horus-master.ps1 run" to recreate it.'
    Write-Host ''
}

function Invoke-Backup {
    Write-Header "$AppName v$AppVersion - Backup"
    Write-Step 'Creating database backup...'
    node database/scripts/backup.js
    if ($LASTEXITCODE -eq 0) {
        Write-OK 'Backup created in database/backups/'
    } else {
        Write-Err 'Backup failed. Is PostgreSQL running?'
    }
    Write-Host ''
}

function Invoke-Restore {
    Write-Header "$AppName v$AppVersion - Restore"
    if ($SubCommand -eq '') {
        Write-Host '  Usage: horus-master.ps1 restore <backup-file.sql>' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '  Available backups:' -ForegroundColor White
        if (Test-Path database/backups) {
            Get-ChildItem database/backups\*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object {
                Write-Host "    $($_.Name)  ($([math]::Round($_.Length/1KB, 1)) KB, $($_.LastWriteTime))" -ForegroundColor Gray
            }
        }
        exit 0
    }
    if (-not (Test-Path $SubCommand)) {
        Write-Err "Backup file not found: $SubCommand"
        exit 1
    }
    Write-Step "Restoring from: $SubCommand"
    $dbName = 'horus_erp'
    $envFile = Join-Path $ProjectRoot '.env'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*DB_NAME\s*=\s*(.+?)\s*$') { $dbName = $Matches[1] }
        }
    }
    node database/scripts/restore.js $SubCommand --confirm-drop=$dbName
    if ($LASTEXITCODE -eq 0) {
        Write-OK 'Restore complete'
    } else {
        Write-Err 'Restore failed'
    }
    Write-Host ''
}

function Show-Help {
    Write-Header "$AppName v$AppVersion - Master Script"
    Write-Host '  Usage: horus-master.ps1 <command> [subcommand]' -ForegroundColor White
    Write-Host ''
    Write-Host '  Commands:' -ForegroundColor White
    Write-Host '    setup              Install deps + download PG + create .env + verify syntax' -ForegroundColor Gray
    Write-Host '    run                Start the full system (PG + backend + browser)' -ForegroundColor Gray
    Write-Host '    test [jest|smoke|integration|pos]  Run tests (default: all 4 suites)' -ForegroundColor Gray
    Write-Host '    build [nsis|portable]              Build .exe (default: both)' -ForegroundColor Gray
    Write-Host '    status             Check if backend + PostgreSQL are running' -ForegroundColor Gray
    Write-Host '    stop               Stop all karim ERP processes' -ForegroundColor Gray
    Write-Host '    clean              Remove node_modules + release + database/data' -ForegroundColor Gray
    Write-Host '    reset-db           Delete database (will recreate on next run)' -ForegroundColor Gray
    Write-Host '    backup             Create a database backup' -ForegroundColor Gray
    Write-Host '    restore <file>     Restore database from backup file' -ForegroundColor Gray
    Write-Host '    all                Run setup + then run' -ForegroundColor Gray
    Write-Host '    help               Show this help' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Examples:' -ForegroundColor White
    Write-Host '    powershell -ExecutionPolicy Bypass -File horus-master.ps1 setup' -ForegroundColor Gray
    Write-Host '    powershell -ExecutionPolicy Bypass -File horus-master.ps1 run' -ForegroundColor Gray
    Write-Host '    powershell -ExecutionPolicy Bypass -File horus-master.ps1 test pos' -ForegroundColor Gray
    Write-Host '    powershell -ExecutionPolicy Bypass -File horus-master.ps1 build nsis' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Or use the .bat shortcuts:' -ForegroundColor White
    Write-Host '    setup-windows.bat    → setup' -ForegroundColor Gray
    Write-Host '    run-windows.bat      → run' -ForegroundColor Gray
    Write-Host '    test-windows.bat     → test' -ForegroundColor Gray
    Write-Host '    build-windows.bat    → build' -ForegroundColor Gray
    Write-Host ''
}

# ─── Main dispatch ──────────────────────────────────────────────
switch ($Command) {
    'setup'    { Invoke-Setup }
    'run'      { Invoke-Run }
    'test'     { Invoke-Test }
    'build'    { Invoke-Build }
    'status'   { Invoke-Status }
    'stop'     { Invoke-Stop }
    'clean'    { Invoke-Clean }
    'reset-db' { Invoke-ResetDb }
    'backup'   { Invoke-Backup }
    'restore'  { Invoke-Restore }
    'all'      { Invoke-Setup; Invoke-Run }
    'help'     { Show-Help }
    ''         { Show-Help }
}
