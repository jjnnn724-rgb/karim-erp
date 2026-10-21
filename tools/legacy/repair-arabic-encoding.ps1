$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'frontend\app\index.html'
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
$legacy = [System.Text.Encoding]::GetEncoding(1256)
$fixed = [System.Text.Encoding]::UTF8.GetString($legacy.GetBytes($text))
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $fixed, $utf8)
Write-Host 'Arabic UTF-8 encoding repaired.' -ForegroundColor Green
