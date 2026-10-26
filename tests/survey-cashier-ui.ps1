$root = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp'
Write-Output '=== menu-board page ==='
Get-ChildItem "$root\frontend\app" -Recurse -Include '*.html','*.js' | Where-Object { $_.Name -match 'menu' } | ForEach-Object { $_.FullName.Replace($root,'') }
Write-Output ''
Write-Output '=== image_url usage in frontend ==='
Get-ChildItem "$root\frontend\app\js\features" -Filter '*.js' | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern 'image_url'
    if ($m) { foreach ($x in ($m | Select-Object -First 3)) { "$(Split-Path -Leaf $_.FullName):$($x.LineNumber): $($x.Line.Trim().Substring(0,[Math]::Min(105,$x.Line.Trim().Length)))" } }
}
Write-Output ''
Write-Output '=== POS screen (cashier) product tiles ==='
Select-String -Path "$root\frontend\app\js\features\cashier.js" -Pattern 'pos_products|posProducts|product' -SimpleMatch:$false | Select-Object -First 8 | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(105,$_.Line.Trim().Length)))" }
