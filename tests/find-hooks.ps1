$k = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\frontend\app\js\features\kitchen.js'
Select-String -Path $k -Pattern 'openDispatchRequest|dispatchDept|function openNewDispatch|newDispatchRequest' | Select-Object -First 8 | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(100,$_.Line.Trim().Length)))" }
Write-Output '--- header/version hooks ---'
$main = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\frontend\app\js'
Get-ChildItem $main -Recurse -Filter '*.js' | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern 'v4\.9|sidebarFooter|class="brand"|topbar|app-version'
    if ($m) { foreach ($x in ($m | Select-Object -First 3)) { "$((Split-Path -Leaf $_.FullName)):$($x.LineNumber): $($x.Line.Trim().Substring(0,[Math]::Min(95,$x.Line.Trim().Length)))" } }
}
