#Requires -RunAsAdministrator
<#
.SYNOPSIS
    karim ERP — تطبيق تحديث هوائي (OTA) على سيرفر الإنتاج.
.DESCRIPTION
    التدفق: تنزيل حزمة ZIP + تحقق SHA-256 ← فك وفحص الإصدار في staging ←
    نسخة احتياطية (DB + .env) ← إيقاف ← تبديل مجلد الإصدار مع حفظ البيانات ←
    ترحيلات ← تشغيل ← فحص صحة ← اعتماد. قبل بدء الترحيلات، يعاد الإصدار السابق
    تلقائيًا عند فشل التبديل؛ بعد بدء الترحيلات تبقى الخدمات متوقفة للتدخل اليدوي
    لأن توافق المخطط مع الإصدار السابق غير مضمون.
    يعمل من أي مسار (نسبي لمكان السكريبت) وعلى أي جهاز.
.PARAMETER PackageUrl
    رابط حزمة ZIP (الإصدار الجديد).
.PARAMETER Sha256
    بصمة SHA-256 للحزمة (إلزامية — بلا استثناء).
.PARAMETER InstallDir
    مجلد المشروع (افتراضي: جذر المشروع الحالي).
.PARAMETER ReleaseVersion
    اسم الإصدار (افتراضي: طابع زمني).
.EXAMPLE
    .\update-production.ps1 -PackageUrl 'https://files.example.com/karim-4.8.0.zip' -Sha256 'ABC123...'
#>
param(
    [Parameter(Mandatory = $true)][string]$PackageUrl,
    [Parameter(Mandatory = $true)][string]$Sha256,
    [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
    [string]$ReleaseVersion = (Get-Date -Format 'yyyyMMdd-HHmmss')
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$Root = Split-Path -Parent $InstallDir
if ($ReleaseVersion -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw 'ReleaseVersion must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens (maximum 64 characters).'
}
. (Join-Path $PSScriptRoot 'deployment-preserve.ps1')
$Work = Join-Path $Root ".karim-update-$ReleaseVersion-$([guid]::NewGuid().ToString('N'))"
$Zip = Join-Path $Work 'release.zip'
$Backup = Join-Path $InstallDir "database\backups\pre-update-$ReleaseVersion"
$RetainedPreviousDeployment = Join-Path $Root ".karim-release-$ReleaseVersion"
if (Test-Path -LiteralPath $Backup) {
    throw "Backup path already exists; choose a new ReleaseVersion: $Backup"
}
if (Test-Path -LiteralPath $RetainedPreviousDeployment) {
    throw "Retained release path already exists; choose a new ReleaseVersion: $RetainedPreviousDeployment"
}
$Port = 5000
if (Test-Path (Join-Path $InstallDir '.env')) {
    $m = Select-String -Path (Join-Path $InstallDir '.env') -Pattern '^PORT=(\d+)' | Select-Object -First 1
    if ($m -and $m.Matches[0].Groups[1].Value) { $Port = $m.Matches[0].Groups[1].Value }
}
New-Item -ItemType Directory -Force -Path $Work | Out-Null

function Log($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function Health-Check {
    foreach ($scheme in @('https', 'http')) {
        try {
            $r = Invoke-WebRequest -Uri "${scheme}://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 15
            if ($r.StatusCode -eq 200) { return $true }
        } catch {}
    }
    return $false
}
function Db-Creds {
    $envFile = Join-Path $InstallDir '.env'
    $get = { param($k, $d) $l = Select-String -Path $envFile -Pattern "^$k=(.*)" 2>$null | Select-Object -First 1; if ($l) { return $l.Matches[0].Groups[1].Value.Trim() } else { return $d } }
    return @{
        User = & $get 'DB_USER' 'postgres'; Pass = & $get 'DB_PASSWORD' ''
        Port = & $get 'DB_PORT' '5432'; Name = & $get 'DB_NAME' 'karim_erp'
    }
}

$services = @('KarimERP-Server', 'AlShorfaERP', 'KarimERP-PrintWorker', 'AlShorfaPrintWorker') |
    ForEach-Object { Get-Service -Name $_ -ErrorAction SilentlyContinue } | Where-Object { $_ }
$runningServiceNames = @($services | Where-Object { $_.Status -eq 'Running' } | ForEach-Object { $_.Name })
$wasRunning = $runningServiceNames.Count -gt 0
$stoppedServiceNames = @()
$switchAttempted = $false
$migrationsStarted = $false
$startedProcess = $null
$preservedPathsForRollback = @()
$previousDeploymentForRecovery = $null
$unmanagedServerProcesses = @()
$unmanagedPrintProcesses = @()

try {
    Log "تنزيل $ReleaseVersion..." Cyan
    Invoke-WebRequest -Uri $PackageUrl -OutFile $Zip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Zip).Hash
    if ($actual.ToUpperInvariant() -ne $Sha256.Trim().ToUpperInvariant()) { throw 'فشل تحقق SHA-256 — الحزمة مرفوضة.' }
    Log 'البصمة سليمة.' Green

    Log 'فك وفحص الحزمة قبل إيقاف الخدمات...' Cyan
    $staging = Join-Path $Work 'staging'
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Expand-Archive -Path $Zip -DestinationPath $staging -Force
    Assert-DeploymentPackage -ReleaseDirectory $staging

    Log 'نسخة احتياطية (DB + .env)...' Cyan
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null
    if (Test-Path (Join-Path $InstallDir '.env')) { Copy-Item (Join-Path $InstallDir '.env') $Backup -Force }
    $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
    if (-not $pgDump) { throw 'pg_dump غير موجود — أُلغي التحديث قبل إيقاف الخدمات أو تغيير الملفات.' }
    $c = Db-Creds
    $env:PGPASSWORD = $c.Pass
    $databaseBackup = Join-Path $Backup 'karim.dump'
    & $pgDump.Source -h 127.0.0.1 -p $c.Port -U $c.User -d $c.Name -F c -f $databaseBackup
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $databaseBackup) -or (Get-Item $databaseBackup).Length -eq 0) {
        throw 'فشل نسخ قاعدة البيانات — توقف قبل أي تغيير.'
    }
    $pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
    if (-not $pgRestore) { throw 'pg_restore غير موجود للتحقق من النسخة — أُلغي التحديث قبل إيقاف الخدمات.' }
    & $pgRestore.Source --list $databaseBackup *> $null
    if ($LASTEXITCODE -ne 0) { throw 'تعذر التحقق من فهرس النسخة الاحتياطية — أُلغي التحديث قبل إيقاف الخدمات.' }

    $preserve = @('.env', 'node_modules', 'database\backups', 'database\data', 'logs', '.git')
    $previousDeployment = Join-Path $Work 'previous'
    $failedDeployment = Join-Path $Work 'failed-release'
    $previousDeploymentForRecovery = $previousDeployment

    Log 'إيقاف الخدمات...' Yellow
    foreach ($serviceName in $runningServiceNames) {
        Stop-Service -Name $serviceName -Force -ErrorAction Stop
        (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        $stoppedServiceNames += $serviceName
    }
    Start-Sleep -Seconds 3
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)
    $unmanagedServerProcesses = @($nodeProcesses | Where-Object {
        $_.CommandLine -match '(?i)(?:^|[\\/\s])backend[\\/]server\.js(?:\s|$)|(?:^|[\\/\s])scripts[\\/]serve\.js(?:\s|$)'
    })
    $unmanagedPrintProcesses = @($nodeProcesses | Where-Object {
        $_.CommandLine -match '(?i)(?:^|[\\/\s])backend[\\/]cashier-module[\\/]print-worker\.js(?:\s|$)'
    })
    if ($unmanagedServerProcesses.Count -gt 0 -or $unmanagedPrintProcesses.Count -gt 0) {
        $processIds = @($unmanagedServerProcesses + $unmanagedPrintProcesses | ForEach-Object { $_.ProcessId }) -join ', '
        throw "Unmanaged Node process(es) still reference the application after service stop (PID: $processIds); update cancelled before switching files."
    }

    Log 'تبديل مجلد الإصدار...' Cyan
    $preservedPathsForRollback = @($preserve | Where-Object {
        Test-Path -LiteralPath (Join-Path $InstallDir $_)
    })
    $switchAttempted = $true
    Switch-DeploymentDirectory -InstallDirectory $InstallDir -StagingDirectory $staging `
        -PreviousDirectory $previousDeployment -PreservedPaths $preservedPathsForRollback
    Retain-PreviousDeployment -PreviousDirectory $previousDeployment `
        -RetainedDirectory $RetainedPreviousDeployment
    $previousDeploymentForRecovery = $RetainedPreviousDeployment

    Log 'اعتماديات + ترحيلات...' Cyan
    Push-Location $InstallDir
    try {
        $migrationsStarted = $true
        & node database/scripts/run-migration.js
        if ($LASTEXITCODE -ne 0) { throw 'فشلت الترحيلات.' }
    } finally { Pop-Location }

    Log 'تشغيل...' Cyan
    if ($wasRunning) {
        foreach ($serviceName in $runningServiceNames) {
            Start-Service -Name $serviceName -ErrorAction Stop
        }
        Start-Sleep -Seconds 5
    } else {
        Push-Location $InstallDir
        try { $startedProcess = Start-Process -FilePath 'node' -ArgumentList 'scripts/serve.js' -WorkingDirectory $InstallDir -PassThru } finally { Pop-Location }
        Start-Sleep -Seconds 25
    }
    if (-not (Health-Check)) { throw 'فحص الصحة فشل بعد التحديث.' }
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
    Log "تم اعتماد $ReleaseVersion. النسخة: $Backup — الإصدار السابق: $RetainedPreviousDeployment" Green
    exit 0
} catch {
    Log "فشل التحديث: $($_.Exception.Message)" Red
    if ($migrationsStarted) {
        if ($startedProcess -and -not $startedProcess.HasExited) {
            try { Stop-Process -Id $startedProcess.Id -Force -ErrorAction Stop }
            catch { Log "تعذر إيقاف عملية الإصدار غير المعتمد: $($_.Exception.Message)" Red }
        }
        foreach ($serviceName in $runningServiceNames) {
            try {
                $service = Get-Service -Name $serviceName -ErrorAction Stop
                if ($service.Status -eq 'Running') { Stop-Service -Name $serviceName -Force -ErrorAction Stop }
            } catch { Log "تعذر إيقاف الخدمة $serviceName بعد فشل النشر: $($_.Exception.Message)" Red }
        }
        Log "بدأت الترحيلات أو مرحلة ما بعدها؛ لم يُجر تراجع آلي لأن توافق مخطط قاعدة البيانات مع الإصدار السابق غير مضمون. اترك الخدمات متوقفة، وراجع الإصدار السابق في $previousDeployment والنسخة الاحتياطية في $Backup قبل أي استعادة." Red
    } elseif ($switchAttempted) {
        $deploymentRecovered = $false
        if ($previousDeploymentForRecovery -and
            (Test-Path -LiteralPath $previousDeploymentForRecovery -PathType Container)) {
            try {
                Restore-PreviousDeployment -InstallDirectory $InstallDir -PreviousDirectory $previousDeploymentForRecovery `
                    -StagingDirectory $staging -FailedDirectory $failedDeployment `
                    -PreservedPaths $preservedPathsForRollback
                $deploymentRecovered = $true
            } catch {
                Log "فشل استرجاع ملفات الإصدار السابق: $($_.Exception.Message)" Red
            }
        } elseif (Test-Path -LiteralPath $InstallDir -PathType Container) {
            $deploymentRecovered = $true
        }

        if ($deploymentRecovered) {
            foreach ($serviceName in $stoppedServiceNames) {
                try {
                    Start-Service -Name $serviceName -ErrorAction Stop
                    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
                } catch { Log "تعذر إعادة تشغيل الخدمة $serviceName بعد استرجاع الملفات: $($_.Exception.Message)" Red }
            }
            Log 'لم تبدأ الترحيلات؛ أُعيدت ملفات الإصدار السابق ومحاولة تشغيل الخدمات التي كانت تعمل.' Yellow
        } else {
            Log "تعذر إثبات استعادة الإصدار السابق. اترك الخدمات متوقفة وافحص المسارين $InstallDir و$previousDeploymentForRecovery يدويًا." Red
        }
    } elseif ($stoppedServiceNames.Count -gt 0) {
        foreach ($serviceName in $stoppedServiceNames) {
            if ($unmanagedServerProcesses.Count -gt 0 -and $serviceName -in @('KarimERP-Server', 'AlShorfaERP')) {
                Log "لم تُعد تشغيل الخدمة $serviceName لوجود عملية خادم مستقلة؛ تحقق منها يدويًا." Red
                continue
            }
            if ($unmanagedPrintProcesses.Count -gt 0 -and $serviceName -in @('KarimERP-PrintWorker', 'AlShorfaPrintWorker')) {
                Log "لم تُعد تشغيل الخدمة $serviceName لوجود عامل طباعة مستقل؛ تحقق منه يدويًا." Red
                continue
            }
            try {
                Start-Service -Name $serviceName -ErrorAction Stop
                (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
            }
            catch { Log "تعذر إعادة تشغيل الخدمة $serviceName : $($_.Exception.Message)" Red }
        }
        Log 'لم يبدأ تغيير الملفات؛ أُعيدت محاولة تشغيل الخدمات التي كانت تعمل قبل التحديث.' Yellow
    } else {
        Log 'لم يبدأ إيقاف الخدمات أو تغيير الملفات؛ حالة الخدمة لم تتغير.' Yellow
    }
    exit 1
}
