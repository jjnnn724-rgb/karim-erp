param([string]$PackagePath = (Split-Path -Parent $MyInvocation.MyCommand.Path), [string]$InstallPath)
$ErrorActionPreference = 'Stop'
$package = [IO.Path]::GetFullPath($PackagePath)
if (-not $InstallPath) { $InstallPath = Join-Path $env:ProgramData 'KarimERP-Docker' }
$InstallPath = [IO.Path]::GetFullPath($InstallPath)
$projectSource = Join-Path $package 'project'
$dump = Join-Path $package 'database.sql'
$imageTar = Join-Path $package 'karim-erp-image.tar'
if ((Test-Path $imageTar) -and -not (Test-Path $projectSource)) {
    $projectSource = $package
}
if (-not (Test-Path (Join-Path $projectSource 'docker-compose.yml')) -or -not (Test-Path $dump)) {
    throw 'Docker package is incomplete: project/docker-compose.yml or database.sql is missing'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop and retry' }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running' }
if (Test-Path $InstallPath) { throw "Install path already exists: $InstallPath. Use -InstallPath for another path" }

Write-Host "Installing to: $InstallPath"
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
& robocopy $projectSource $InstallPath /E /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw 'Docker project copy failed' }

$envFile = Join-Path $InstallPath '.env'
$envText = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { '' }
function Set-EnvValue([string]$name, [string]$value) {
    $script:envText = [regex]::Replace($script:envText, "(?m)^$name=.*$", "$name=$value")
    if ($script:envText -notmatch "(?m)^$name=") { $script:envText += "`n$name=$value`n" }
}
Set-EnvValue 'DB_HOST' 'db'
Set-EnvValue 'DB_PORT' '5432'
Set-EnvValue 'PORT' '5000'
Set-EnvValue 'HOST' '0.0.0.0'
Set-EnvValue 'ALLOWED_ORIGINS' 'http://localhost:5000'
Set-Content $envFile $envText -NoNewline -Encoding UTF8

$compose = Join-Path $InstallPath 'docker-compose.yml'
if (Test-Path $imageTar) {
    Write-Host '[0/3] Loading Docker image...'
    docker load -i $imageTar
    if ($LASTEXITCODE -ne 0) { throw 'Docker image load failed' }
}
Write-Host '[1/3] Starting PostgreSQL container...'
& docker compose -p karim-erp -f $compose up -d db
if ($LASTEXITCODE -ne 0) { throw 'Failed to start PostgreSQL in Docker' }
for ($i = 0; $i -lt 30; $i++) {
    & docker compose -p karim-erp -f $compose exec -T db pg_isready -U postgres -d karim_erp *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
    if ($i -eq 29) { throw 'PostgreSQL did not become ready within one minute' }
}

Write-Host '[2/3] Restoring database...'
& docker cp $dump 'karim-erp-db:/tmp/karim-erp-import.sql'
& docker compose -p karim-erp -f $compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/karim-erp-import.sql'
if ($LASTEXITCODE -ne 0) { throw 'Database restore failed' }

Write-Host '[3/3] Building and starting Karim ERP...'
if (Test-Path $imageTar) {
    & docker compose -p karim-erp -f $compose up -d --no-build app
} else {
    & docker compose -p karim-erp -f $compose up -d --build app
}
if ($LASTEXITCODE -ne 0) { throw 'Failed to build or start Karim ERP' }
$appContainer = (& docker compose -p karim-erp -f $compose ps -q app).Trim()
if ($appContainer) {
    $waRoot = Join-Path $package 'whatsapp-data'
    foreach ($name in @('sessions', 'backups', 'media')) {
        $source = Join-Path $waRoot $name
        if (Test-Path $source) {
            & docker cp "$source\." "${appContainer}:/app/data/whatsapp-$name"
        }
    }
    & docker compose -p karim-erp -f $compose restart app | Out-Null
}
Write-Host "DONE: http://localhost:5000/app/index.html" -ForegroundColor Green