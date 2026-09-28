$c = Get-Content 'C:\Users\USER1\Desktop\hh\karim-erp\frontend\app\js\app.js'
$line = $c[6072]
# Find all onclick handlers with IDs
$pattern = 'onclick="[^"]*\$\{[^}]*\.[iI][dD]\}[^"]*"'
$matches = [regex]::Matches($line, $pattern)
foreach($m in $matches) { Write-Host "FOUND: $($m.Value)" }
