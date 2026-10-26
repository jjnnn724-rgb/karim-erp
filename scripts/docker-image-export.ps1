param([string]$Destination = '\\tsclient\E\KarimMigration')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
if ($Destination -match '^\\\\tsclient\\([A-Za-z])\\?(.*)$') {
    $drive = $Matches[1]
    $tail = $Matches[2]
    if (Test-Path "$drive`:\") { $Destination = "$drive`:\$tail" }
}
$out = Join-Path ([IO.Path]::GetFullPath($Destination)) "KarimERP-Docker-Image-$stamp"
try {
    New-Item -ItemType Directory -Path $out -Force | Out-Null
} catch {
    throw "Cannot write to '$Destination'. Enable RDP drive redirection or use a writable local drive such as E:\KarimMigration."
}
Set-Location $root

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running' }
$tag = 'karim-erp:portable'
Write-Host '[1/4] Building Docker image...'
docker build -t $tag .
if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed' }

Write-Host '[2/4] Saving Docker image to USB...'
docker save -o (Join-Path $out 'karim-erp-image.tar') $tag
if ($LASTEXITCODE -ne 0) { throw 'Docker image save failed' }

Write-Host '[3/4] Exporting database...'
$dump = Join-Path $out 'database.sql'
node (Join-Path $root 'database/scripts/backup.js') $dump
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump)) { throw 'Database dump failed' }
Copy-Item "$dump.sha256" (Join-Path $out 'database.sql.sha256') -Force
Copy-Item (Join-Path $root 'docker-compose.yml') $out -Force
Copy-Item (Join-Path $root '.env') (Join-Path $out '.env') -Force
Copy-Item (Join-Path $root 'DOCKER-USB-IMPORT.bat') $out -Force
Copy-Item (Join-Path $root 'DOCKER-USB-IMPORT.ps1') $out -Force
@{ image = $tag; created_at = (Get-Date).ToString('o'); database = 'database.sql' } |
    ConvertTo-Json | Set-Content (Join-Path $out 'manifest.json') -Encoding ASCII

Write-Host '[4/4] Image package ready' -ForegroundColor Green
Write-Host $out