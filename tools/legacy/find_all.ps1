$c = Get-Content 'C:\Users\USER1\Desktop\hh\karim-erp\frontend\app\js\app.js'
$line = $c[6072]
$matches = [regex]::Matches($line, 'onclick="[^"]*')
foreach($m in $matches) { 
    $val = $m.Value
    if ($val -match '\$\{.*\.id\}' -and $val -notmatch "'\$\{") {
        Write-Host "NEEDS FIX: $val"
    }
}
