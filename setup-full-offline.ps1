# Karim ERP - Full Offline deployment preparation
# Run as Administrator on the ERP server while internet is available once.
[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [int]$Port = 5001
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = (Get-Location).Path
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
Set-Location -LiteralPath $ProjectRoot

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Install Node.js/npm, then run this script again."
    }
}

Require-Command 'node.exe'
Require-Command 'npm.cmd'

Write-Host '[1/6] Installing frontend libraries locally...' -ForegroundColor Cyan
& npm.cmd install --save chart.js@4.4.0 xlsx@0.18.5 html5-qrcode@2.3.8 --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

$vendor = Join-Path $ProjectRoot 'frontend\app\vendor'
New-Item -ItemType Directory -Force -Path $vendor | Out-Null

Write-Host '[2/6] Copying libraries into the offline app shell...' -ForegroundColor Cyan
function Find-PackageAsset([string]$packageName, [string[]]$preferredNames) {
    $packageRoot = Join-Path $ProjectRoot "node_modules\$packageName"
    if (-not (Test-Path $packageRoot)) { throw "Package is missing: $packageName" }
    $files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($name in $preferredNames) {
        $match = $files | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    throw "No browser distribution file found for package: $packageName"
}

$copies = @(
    @{ Package = 'chart.js'; Names = @('chart.umd.min.js', 'chart.umd.js'); Destination = 'chart.umd.min.js' },
    @{ Package = 'xlsx'; Names = @('xlsx.full.min.js', 'xlsx.full.js', 'xlsx.js'); Destination = 'xlsx.full.min.js' },
    @{ Package = 'html5-qrcode'; Names = @('html5-qrcode.min.js', 'html5-qrcode.js'); Destination = 'html5-qrcode.min.js' }
)
foreach ($item in $copies) {
    $source = Find-PackageAsset $item.Package $item.Names
    Copy-Item -LiteralPath $source -Destination (Join-Path $vendor $item.Destination) -Force
    Write-Host "  $($item.Package): $source"
}

Write-Host '[3/6] Switching the app shell to local assets...' -ForegroundColor Cyan
$indexPath = Join-Path $ProjectRoot 'frontend\app\index.html'
$index = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
$index = $index.Replace('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', '/app/vendor/chart.umd.min.js')
$index = $index.Replace('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', '/app/vendor/xlsx.full.min.js')
$index = $index.Replace('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js', '/app/vendor/html5-qrcode.min.js')
$index = $index.Replace('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Cairo:wght@400;500;600;700;800&family=Aref+Ruqaa:wght@400;700&display=swap', 'css/offline-fonts.css')
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($indexPath, $index, $utf8)

Write-Host '[4/6] Preparing local fonts and assets...' -ForegroundColor Cyan
$fontDir = Join-Path $ProjectRoot 'frontend\app\assets\fonts'
New-Item -ItemType Directory -Force -Path $fontDir | Out-Null
Write-Host '  Font files are optional; the app has local system fallbacks when offline.'

Write-Host '[5/6] Validating the offline asset set...' -ForegroundColor Cyan
Get-ChildItem -LiteralPath $vendor -File | Select-Object Name,Length | Format-Table -AutoSize

Write-Host '[6/6] Next service steps...' -ForegroundColor Cyan
Write-Host "Set PORT=$Port and SSL paths in .env, then restart KarimERP-Server."
Write-Host 'The frontend is now configured to use local vendor files without CDN access.' -ForegroundColor Green
Write-Host 'Copy the complete project folder and node_modules to an offline server; do not run npm install there.' -ForegroundColor Yellow
