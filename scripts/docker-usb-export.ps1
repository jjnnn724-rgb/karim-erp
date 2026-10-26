param([string]$UsbRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $UsbRoot) {
    $volumes = @(Get-Volume | Where-Object {
        $_.DriveLetter -and $_.DriveType -eq 'Removable' -and
        $_.FileSystem -and $_.FileSystemLabel -notmatch 'DVD|CD' -and
        $_.SizeRemaining -gt 2GB
    })
    if ($volumes.Count -ne 1) {
        throw 'Specify the USB path: DOCKER-USB-EXPORT.bat E:\'
    }
    $UsbRoot = "$($volumes[0].DriveLetter):\"
}
$UsbRoot = [IO.Path]::GetFullPath($UsbRoot)
if (-not (Test-Path $UsbRoot)) { throw "USB path is not available: $UsbRoot" }

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$out = Join-Path $UsbRoot "KarimERP-Docker-$stamp"
$project = Join-Path $out 'project'
New-Item -ItemType Directory -Path $project -Force | Out-Null
Write-Host "USB package: $out"

Write-Host '[1/4] Copying project files...'
& robocopy $root $project /E /XD node_modules logs .git .hg .vscode release database\backups /XF *.log /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw 'Project copy failed' }

Write-Host '[2/4] Creating database dump...'
$dump = Join-Path $out 'database.sql'
& node (Join-Path $root 'database/scripts/backup.js') $dump
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump)) { throw 'Database dump failed' }
Copy-Item ("$dump.sha256") (Join-Path $out 'database.sql.sha256') -Force

Write-Host '[3/5] Copying WhatsApp data...'
$waRoot = Join-Path $out 'whatsapp-data'
New-Item -ItemType Directory -Path $waRoot -Force | Out-Null
$waPaths = @{
    sessions = 'C:\HorusData\whatsapp-sessions'
    backups = 'C:\HorusData\whatsapp-backups'
    media = 'C:\HorusData\whatsapp-media'
}
foreach ($name in $waPaths.Keys) {
    $source = $waPaths[$name]
    $target = Join-Path $waRoot $name
    if (Test-Path $source) {
        & robocopy $source $target /E /NFL /NDL /NJH /NJS
        if ($LASTEXITCODE -ge 8) { throw "WhatsApp data copy failed: $name" }
    } else { New-Item -ItemType Directory -Path $target -Force | Out-Null }
}

Write-Host '[4/5] Adding Docker launcher...'
Copy-Item (Join-Path $root 'DOCKER-USB-IMPORT.bat') $out -Force
Copy-Item (Join-Path $root 'DOCKER-USB-IMPORT.ps1') $out -Force
@{ created_at = (Get-Date).ToString('o'); source = $root; database = 'database.sql'; format = 'plain-sql' } |
    ConvertTo-Json | Set-Content (Join-Path $out 'manifest.json') -Encoding UTF8

Write-Host '[5/5] Verifying package...'
if (-not (Test-Path (Join-Path $project 'docker-compose.yml'))) { throw 'docker-compose.yml is missing' }
if ((Get-Item $dump).Length -lt 1024) { throw 'database.sql is empty or too small' }
Write-Host "EXPORT COMPLETE: $out" -ForegroundColor Green