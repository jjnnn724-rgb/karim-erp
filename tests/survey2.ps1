$root = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\frontend\app\js'
Get-ChildItem "$root\features" -Filter '*.js' | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern 'posProducts'
    if ($m) { "$(Split-Path -Leaf $_.FullName): $($m.Count) hit(s), first at $($m[0].LineNumber)" }
}
Write-Output '=== menu-board.html head ==='
Get-Content 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\frontend\app\menu-board.html' -TotalCount 22 -Encoding UTF8
