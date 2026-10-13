$ErrorActionPreference = 'Continue'
$root = 'C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp'

Write-Output '=== 1) last_login_at references in source ==='
$dirs = @("$root\backend\src", "$root\database", "$root\common", "$root\scripts")
$hits = Get-ChildItem $dirs -Recurse -File -Include *.ts,*.js,*.sql -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules' } |
    Select-String -Pattern 'last_login_at'
$hits | Select-Object -First 12 | ForEach-Object {
    $line = $_.Line.Trim()
    Write-Output ($_.Path.Replace($root,'') + ':' + $_.LineNumber + ': ' + $line.Substring(0,[Math]::Min(140,$line.Length)))
}
Write-Output ('Total hits: ' + ($hits | Measure-Object).Count)

Write-Output ''
Write-Output '=== 2) Database direct check ==='
$envLines = Get-Content "$root\.env" -ErrorAction SilentlyContinue
$du = ($envLines | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' }) -replace '^\s*DATABASE_URL\s*=\s*','' | Select-Object -First 1
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if($du -match 'postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):?(\d*)/(.+?)(\?|$)'){
    $dbUser=$Matches[1]; $dbPass=$Matches[2]; $dbHost=$Matches[3]; $dbPort=if($Matches[4]){$Matches[4]}else{'5432'}; $dbName=$Matches[5]
    Write-Output ("DB: user=$dbUser host=$dbHost port=$dbPort db=$dbName")
    $env:PGPASSWORD = $dbPass
    & $psql "-U$dbUser" "-h$dbHost" "-p$dbPort" "-d$dbName" -v ON_ERROR_STOP=0 -t -A -c "SELECT 'connected: db='||current_database()||' size='||pg_size_pretty(pg_database_size(current_database()));"
    Write-Output ''
    Write-Output '--- tables by row count ---'
    & $psql "-U$dbUser" "-h$dbHost" "-p$dbPort" "-d$dbName" -t -A -F ' | ' -c "SELECT c.relname, s.n_live_tup FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid ORDER BY s.n_live_tup DESC LIMIT 40;"
    Write-Output ''
    Write-Output '--- users table columns ---'
    & $psql "-U$dbUser" "-h$dbHost" "-p$dbPort" "-d$dbName" -t -A -c "SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='users';"
} else {
    Write-Output 'DATABASE_URL not found/parsed in .env'
    $envLines | Where-Object { $_ -match 'DB|DATABASE|POSTGRES' } | ForEach-Object { ($_ -replace '(password|PASSWORD)=.*','$1=<hidden>') }
}

Write-Output ''
Write-Output '=== 3) App logs (latest) ==='
$logs = Get-ChildItem "$root\logs" -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
$logs | ForEach-Object { Write-Output ($_.FullName.Replace($root,'') + ' | ' + $_.LastWriteTime + ' | ' + [math]::Round($_.Length/1KB,1) + ' KB') }
if($logs){
    $latest = $logs | Select-Object -First 1
    Write-Output ('--- errors in ' + $latest.Name + ' ---')
    $errLines = Select-String -Path $latest.FullName -Pattern 'ERROR|Error:|FATAL' -ErrorAction SilentlyContinue
    Write-Output ('Error lines count: ' + ($errLines | Measure-Object).Count)
    $errLines | Select-Object -Last 6 | ForEach-Object { $l=$_.Line; Write-Output ($l.Substring(0,[Math]::Min(160,$l.Length))) }
}

Write-Output ''
Write-Output '=== 4) Status files ==='
Get-Content "$root\database\backups\watchdog-status.json" -ErrorAction SilentlyContinue
Get-Content "$root\database\backups\nightly-backup-status.json" -ErrorAction SilentlyContinue
Write-Output ''
Write-Output '--- punch-reconcile.log tail ---'
Get-Content "$root\database\backups\punch-reconcile.log" -Tail 10 -ErrorAction SilentlyContinue
