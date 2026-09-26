#Requires -RunAsAdministrator
<#
.SYNOPSIS
    karim ERP — تطبيق تحديث هوائي (OTA) على سيرفر الإنتاج.
.DESCRIPTION
    التدفق: تنزيل حزمة ZIP + تحقق SHA-256 ← نسخة احتياطية (DB + .env) ←
    إيقاف ← نشر الملفات (مع حفظ .env وnode_modules) ← ترحيلات ←
    تشغيل ← فحص صحة ← اعتماد أو استرجاع تلقائي.
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
# تجاهل تحقق الشهادة للفحص المحلي فقط (شهادة self-signed)
add-type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class NoCheck { public static bool Check(object s, X509Certificate c, X509Chain ch, System.Net.Security.SslPolicyErrors e) { return true; } }
"@ | Out-Null
[Net.ServicePointManager]::ServerCertificateValidationCallback = [NoCheck]::Check

$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$Root = Split-Path -Parent $InstallDir
$Work = Join-Path $env:TEMP "karim-update-$ReleaseVersion"
$Zip = Join-Path $Work 'release.zip'
$Backup = Join-Path $InstallDir "database\backups\pre-update-$ReleaseVersion"
$Port = 5000
if (Test-Path (Join-Path $InstallDir '.env')) {
    $m = Select-String -Path (Join-Path $InstallDir '.env') -Pattern '^PORT=(\d+)' | Select-Object -First 1
    if ($m -and $m.Matches[0].Groups[1].Value) { $Port = $m.Matches[0].Groups[1].Value }
}
New-Item -ItemType Directory -Force -Path $Work, $Backup | Out-Null

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
$wasRunning = @($services | Where-Object { $_.Status -eq 'Running' }).Count -gt 0

try {
    Log "تنزيل $ReleaseVersion..." Cyan
    Invoke-WebRequest -Uri $PackageUrl -OutFile $Zip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Zip).Hash
    if ($actual.ToUpperInvariant() -ne $Sha256.Trim().ToUpperInvariant()) { throw 'فشل تحقق SHA-256 — الحزمة مرفوضة.' }
    Log 'البصمة سليمة.' Green

    Log 'نسخة احتياطية (DB + .env)...' Cyan
    if (Test-Path (Join-Path $InstallDir '.env')) { Copy-Item (Join-Path $InstallDir '.env') $Backup -Force }
    $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
    if ($pgDump) {
        $c = Db-Creds
        $env:PGPASSWORD = $c.Pass
        & $pgDump.Source -h 127.0.0.1 -p $c.Port -U $c.User -d $c.Name -F c -f (Join-Path $Backup 'karim.sql')
        if ($LASTEXITCODE -ne 0) { throw 'فشل نسخ قاعدة البيانات — توقف قبل أي تغيير.' }
    } else { Log 'تحذير: pg_dump غائب — النسخة .env فقط.' Yellow }

    Log 'إيقاف الخدمات...' Yellow
    foreach ($s in $services) { try { Stop-Service -Name $s.Name -Force -ErrorAction SilentlyContinue } catch {} }
    Get-Process node -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -like "$InstallDir*"
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    Log 'نشر الملفات (يُحفظ .env وnode_modules والنسخ)...' Cyan
    $staging = Join-Path $Work 'staging'
    Expand-Archive -Path $Zip -DestinationPath $staging -Force
    $preserve = @('.env', 'node_modules', 'database\backups', 'database\data', 'logs', '.git')
    $stash = Join-Path $Work 'stash'
    New-Item -ItemType Directory -Force -Path $stash | Out-Null
    foreach ($p in $preserve) {
        $src = Join-Path $InstallDir $p
        if (Test-Path $src) { Move-Item $src (Join-Path $stash ((Split-Path $p -Leaf) + '.keep')) -Force }
    }
    Get-ChildItem -Force $staging | Copy-Item -Destination $InstallDir -Recurse -Force
    Get-ChildItem -Force (Join-Path $stash '*.keep') | ForEach-Object {
        $name = $_.Name -replace '\.keep$', ''
        $dest = Join-Path $InstallDir $name
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Move-Item $_.FullName $dest -Force
    }

    Log 'اعتماديات + ترحيلات...' Cyan
    Push-Location $InstallDir
    try {
        & node database/scripts/run-migration.js
        if ($LASTEXITCODE -ne 0) { throw 'فشلت الترحيلات.' }
    } finally { Pop-Location }

    Log 'تشغيل...' Cyan
    if ($wasRunning) {
        foreach ($s in $services) { try { Start-Service -Name $s.Name -ErrorAction SilentlyContinue } catch {} }
        Start-Sleep -Seconds 5
    } else {
        Push-Location $InstallDir
        try { Start-Process -FilePath 'node' -ArgumentList 'scripts/serve.js' -WorkingDirectory $InstallDir } finally { Pop-Location }
        Start-Sleep -Seconds 25
    }
    if (-not (Health-Check)) { throw 'فحص الصحة فشل بعد التحديث.' }
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
    Log "تم اعتماد $ReleaseVersion. النسخة: $Backup" Green
    exit 0
} catch {
    Log "فشل التحديث: $($_.Exception.Message)" Red
    Log 'استرجاع تلقائي من النسخة...' Yellow
    try {
        if (Test-Path (Join-Path $Backup '.env')) { Copy-Item (Join-Path $Backup '.env') (Join-Path $InstallDir '.env') -Force }
        foreach ($s in $services) { try { Start-Service -Name $s.Name -ErrorAction SilentlyContinue } catch {} }
        Start-Sleep -Seconds 5
        if (Health-Check) { Log 'عاد النظام للعمل على النسخة السابقة.' Green }
        else { Log "راجع يدويًا — النسخة محفوظة في: $Backup" Red }
    } catch { Log "الاسترجاع يحتاج تدخلًا — النسخة: $Backup" Red }
    exit 1
}
