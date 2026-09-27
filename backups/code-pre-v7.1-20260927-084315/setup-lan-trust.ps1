# Karim ERP - Trusted LAN HTTPS setup
# Run this script as Administrator on the ERP server.
[CmdletBinding()]
param(
    [int]$Port = 5001,
    [string]$CertDirectory = 'C:\HorusData\certs'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $projectRoot '.env'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator.'
    }
}

function Find-Mkcert {
    $command = Get-Command mkcert.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @(
        "$env:ChocolateyInstall\bin\mkcert.exe",
        "$env:USERPROFILE\scoop\shims\mkcert.exe",
        "$env:USERPROFILE\scoop\apps\mkcert\current\mkcert.exe",
        "$env:ProgramFiles\mkcert\mkcert.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\FiloSottile.mkcert_*\mkcert.exe"
    )
    $match = $candidates | ForEach-Object { Get-ChildItem -Path $_ -File -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($match) { return $match.FullName }

    Write-Host 'mkcert.exe was not found. Attempting automatic installation...' -ForegroundColor Yellow
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    $choco = Get-Command choco.exe -ErrorAction SilentlyContinue
    $scoop = Get-Command scoop.cmd -ErrorAction SilentlyContinue
    if ($winget) {
        & $winget.Source install --id FiloSottile.mkcert --exact --accept-source-agreements --accept-package-agreements | Out-Host
    } elseif ($choco) {
        & $choco.Source install mkcert --yes --no-progress | Out-Host
    } elseif ($scoop) {
        & $scoop.Source install mkcert | Out-Host
    } else {
        throw 'mkcert.exe was not found and no supported package manager (winget, choco, or scoop) is available.'
    }

    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $command = Get-Command mkcert.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $match = $candidates | ForEach-Object { Get-ChildItem -Path $_ -File -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($match) { return $match.FullName }
    throw 'mkcert installation completed but mkcert.exe is not on PATH. Close and reopen PowerShell, then run setup-lan-trust.ps1 again.'
}

function Set-EnvValue([string]$name, [string]$value) {
    $lines = if (Test-Path $envFile) { @(Get-Content -LiteralPath $envFile) } else { @() }
    $escapedName = [regex]::Escape($name)
    $found = $false
    $lines = @($lines | ForEach-Object {
        if ($_ -match "^$escapedName=") {
            $found = $true
            "$name=$value"
        } else { $_ }
    })
    if (-not $found) { $lines += "$name=$value" }
    Set-Content -LiteralPath $envFile -Value $lines -Encoding UTF8
}

Assert-Administrator
$mkcert = Find-Mkcert
New-Item -ItemType Directory -Force -Path $CertDirectory | Out-Null

$hostName = [System.Net.Dns]::GetHostName().ToLowerInvariant()
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
if (-not $lanIp) {
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
        Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $lanIp) { throw 'Could not detect a LAN IPv4 address.' }

& $mkcert -install | Out-Host
$caRoot = (& $mkcert -CAROOT).Trim()
$certPath = Join-Path $CertDirectory 'karim-erp-lan.pem'
$keyPath = Join-Path $CertDirectory 'karim-erp-lan-key.pem'
$clientCaPath = Join-Path $CertDirectory 'Karim-Local-CA.crt'

$names = @(
    'localhost', '127.0.0.1', '::1',
    $hostName, "$hostName.local", 'karim-erp.local', $lanIp
)
& $mkcert '-cert-file' $certPath '-key-file' $keyPath @names | Out-Host
$rootCaPem = Join-Path $caRoot 'rootCA.pem'
if (-not (Test-Path $rootCaPem)) { throw "mkcert root CA not found at $rootCaPem" }
Copy-Item -LiteralPath $rootCaPem -Destination $clientCaPath -Force

Set-EnvValue 'HOST' '0.0.0.0'
Set-EnvValue 'PORT' $Port
Set-EnvValue 'SSL_KEY' ($keyPath -replace '\\', '/')
Set-EnvValue 'SSL_CERT' ($certPath -replace '\\', '/')
Set-EnvValue 'ALLOWED_ORIGINS' "https://localhost:$Port,https://127.0.0.1:$Port,https://$lanIp`:$Port,https://$hostName`:$Port,https://$hostName.local`:$Port,https://karim-erp.local`:$Port"

$ruleName = "Karim ERP HTTPS $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private | Out-Null
}

Write-Host ''
Write-Host 'Trusted LAN HTTPS is ready.' -ForegroundColor Green
Write-Host "Server URL: https://$lanIp`:$Port/app/index.html"
Write-Host "Host URL:   https://$hostName`:$Port/app/index.html"
Write-Host "Client CA:  $clientCaPath"
Write-Host ''
Write-Host 'Install the Client CA on every client device, then restart its browser.' -ForegroundColor Yellow
Write-Host 'Restart KarimERP-Server after this script completes.' -ForegroundColor Yellow
