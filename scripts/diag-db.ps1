$ErrorActionPreference = 'Continue'
$root = 'C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp'
$envLines = Get-Content "$root\.env"
$u = (($envLines | Where-Object { $_ -match '^\s*DB_USER\s*=' }) -replace '^\s*DB_USER\s*=\s*','')
$p = (($envLines | Where-Object { $_ -match '^\s*DB_PASSWORD\s*=' }) -replace '^\s*DB_PASSWORD\s*=\s*','')
$n = (($envLines | Where-Object { $_ -match '^\s*DB_NAME\s*=' }) -replace '^\s*DB_NAME\s*=\s*','')
$env:PGPASSWORD = $p
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

Write-Output '=== A) Databases on this server ==='
& $psql "-U$u" -h 127.0.0.1 -p 5432 -d postgres -t -A -F ' | ' -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate ORDER BY datname;"

Write-Output ''
Write-Output '=== B) Who is connected (grouped) ==='
& $psql "-U$u" -h 127.0.0.1 -p 5432 -d postgres -t -A -F ' | ' -c "SELECT datname, application_name, usename, client_addr, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3,4,5 ORDER BY 6 DESC LIMIT 15;"

Write-Output ''
Write-Output '=== C) karim_erp: tables by rows ==='
& $psql "-U$u" -h 127.0.0.1 -p 5432 -d $n -t -A -F ' | ' -c "SELECT c.relname, s.n_live_tup FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid ORDER BY s.n_live_tup DESC LIMIT 45;"

Write-Output ''
Write-Output '=== D) karim_erp: users columns ==='
& $psql "-U$u" -h 127.0.0.1 -p 5432 -d $n -t -A -c "SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='users';"

Write-Output ''
Write-Output '=== E) horus_erp exists? users.last_login_at there? ==='
$du = (& $psql "-U$u" -h 127.0.0.1 -p 5432 -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datname='horus_erp';")
if($du -eq 'horus_erp'){
    & $psql "-U$u" -h 127.0.0.1 -p 5432 -d horus_erp -t -A -c "SELECT 'horus users.last_login_at exists: '||count(*) FROM information_schema.columns WHERE table_name='users' AND column_name='last_login_at';"
} else {
    Write-Output 'horus_erp database does not exist'
}
