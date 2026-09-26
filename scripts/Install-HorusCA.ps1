# Install-HorusCA.ps1
# Run as Administrator on each client computer
# This installs the Horus ERP local CA certificate

$certPath = "C:\HorusData\certs\horus-local-ca.crt"
$storeName = "Root"

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Horus ERP CA Certificate Installer" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator!" -ForegroundColor Red
    Write-Host "Right-click: Run as Administrator" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $certPath)) {
    Write-Host "ERROR: Certificate not found at $certPath" -ForegroundColor Red
    Write-Host "Copy the file from: C:\HorusData\certs\horus-local-ca.crt" -ForegroundColor Yellow
    exit 1
}

# Import the certificate
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath)
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "LocalMachine")
$store.Open("MaxAllowed")
$store.Add($cert)
$store.Close()

Write-Host ""
Write-Host "[OK] Certificate installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now access:" -ForegroundColor Cyan
Write-Host "  https://192.168.1.165:5001" -ForegroundColor Cyan
Write-Host "  https://DESKTOP-Q60J4VI:5001" -ForegroundColor Cyan
Write-Host ""
