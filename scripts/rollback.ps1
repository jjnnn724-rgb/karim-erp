<#
.SYNOPSIS
  rollback.ps1 — التراجع الآمن عن آخر نشر عبر نسخ frontend/v3

.DESCRIPTION
  يعيد frontend/v3/ إلى أحد backup v3-live-*-pre-*، يعيد تشغيل الخدمة
  ثم يقيس /api/health محليًا. يعمل بحسب آخر مكان نسخة مرّ النسخ أو يتضمن:
  .\rollback.ps1 -Latest                 (آخر ليلة نشر)
  .\rollback.ps1 -List                   (يعرض النسخ المتاحة)
  .\rollback.ps1 -Auto                   (يدمج backup+service+verify)
#>

[CmdletBinding()]
param(
    [switch]$List,
    [switch]$Latest,
    [switch]$Auto
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backups = Join-Path $Root 'backups'
$App = Join-Path $Root 'frontend' 'v3'
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory $LogDir | Out-Null }
$Log = Join-Path $LogDir ("rollback-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')
function Log($line) { Add-Content $Log ("{0} | {1}" -f (Get-Date -Format o), $line); Write-Host $line }

# ── (أ) النسخ المتاحة
function Get-Versions {
    Get-ChildItem -Directory -Path $Backups -Filter 'v3-live-*-pre-*' |
        Sort-Object LastWriteTime -Descending |
        Select-Object Name, LastWriteTime
}

if ($List) {
    Get-Versions | Format-Table -AutoSize
    exit 0
}

$Snap = $null
if ($Latest -or $Auto) {
    $Snap = Get-ChildItem -Directory -Path $Backups -Filter 'v3-live-*-pre-*' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $Snap) {
        Write-Error "لم يُعثر على أي نسخة backup تحت: $Backups/v3-live-*-pre-*"
        exit 1
    }
} else {
    Get-Versions | Format-Table -AutoSize
    Write-Host "استخدم -Latest لاستعادة آخر نسخة، أو -Auto للتحقق تلقائيًا."
    exit 0
}

# ── (ب) برمجة التراجع
Log "ROLLING BACK: $App → $($Snap.FullName)"

# احذف النسخة الحالية المتوقعة كاملة — نسخ التخوين كاملة المفاتيح
Remove-Item -Recurse -Force $App
Copy-Item -Recurse -Force (Join-Path $Snap.FullName '*') $App
Write-Host "✓ النسخة تم نسخها من $($Snap.Name) إلى $App"
Log "copied $($Snap.Name) -> $App"

# ── (ج) إعادة تشغيل الخدمة والتحقق
Write-Host "↻ إعادة تشغيل الخدمة..."
Restart-Service -Name 'KarimERP-Server' -Force
Start-Sleep -Seconds 5

$Health = $null
for ($i = 0; $i -lt 20; $i++) {
    try {
        $resp = & curl.exe -sk -m 5 -o NUL -w '%{http_code}' 'https://127.0.0.1:5000/api/health'
        if ($resp -eq '200') { $Health = 200; break }
    } catch { Start-Sleep -Seconds 2 }
}

if ($Health -eq 200) {
    Log "HEALTH 200 after rollback — SUCCESS"
    Write-Host "✓ /api/health = 200 — التراجع اكتمل بنجاح"
    exit 0
} else {
    Log "HEALTH FAILED after rollback — INVESTIGATE"
    Write-Error "✗ /api/health لم يُرجع 200 بعد التراجع — انظر logs/app-out.log"
    exit 1
}
