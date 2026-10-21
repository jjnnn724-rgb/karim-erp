$root = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\frontend\app\js'
Write-Output '=== who calls POS sale APIs ==='
Get-ChildItem "$root\features" -Filter '*.js' | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern 'pos/sales|/pos/orders|complete-sale|pos/complete'
    if ($m) { "$(Split-Path -Leaf $_.FullName): $($m.Count) hits, first $($m[0].LineNumber)" }
}
Write-Output '=== menu-board.js image handling ==='
Select-String -Path "$root\menu-board.js" -Pattern 'image|img|photo|صورة' | Select-Object -First 6 | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(105,$_.Line.Trim().Length)))" }
Write-Output '=== menu-admin.js image handling ==='
Select-String -Path "$root\menu-admin.js" -Pattern 'image|img|صورة' | Select-Object -First 6 | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(105,$_.Line.Trim().Length)))" }
Write-Output '=== menu-admin product save endpoint ==='
Select-String -Path "$root\menu-admin.js" -Pattern 'apiFetch\(' | Select-Object -First 8 | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(105,$_.Line.Trim().Length)))" }
