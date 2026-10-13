$f = 'C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\logs\app-out.log'
$fs = [System.IO.File]::Open($f,'Open','Read','ReadWrite')
$fs.Seek(-2000000,[System.IO.SeekOrigin]::End) | Out-Null
$sr = New-Object System.IO.StreamReader($fs)
$tail = $sr.ReadToEnd()
$sr.Close(); $fs.Close()
$tmp = Join-Path $env:TEMP 'app_tail.txt'
Set-Content -Path $tmp -Value $tail -Encoding UTF8
$lines = Get-Content $tmp
Write-Output ('Lines in last 2MB: ' + $lines.Count)
$err = @($lines | Where-Object { $_.Contains('"level":"ERROR"') })
$warn = @($lines | Where-Object { $_.Contains('"level":"WARN"') })
Write-Output ('ERROR level: ' + $err.Count)
Write-Output ('WARN level: ' + $warn.Count)
Write-Output ''
Write-Output '--- WARN events grouped ---'
$warn | ForEach-Object { if($_ -match '"event":"([^"]+)"'){ $Matches[1] } } | Group-Object | Sort-Object Count -Descending | Select-Object -First 8 Count,Name | Format-Table -AutoSize
Write-Output '--- one full WARN sample ---'
if($warn.Count -gt 0){ $w = $warn[0]; Write-Output $w.Substring(0,[Math]::Min(1000,$w.Length)) }
Write-Output ''
Write-Output '--- last 3 ERROR samples (if any) ---'
$err | Select-Object -Last 3 | ForEach-Object { Write-Output $_.Substring(0,[Math]::Min(400,$_.Length)) }
