$root = 'C:\Users\RemoteHome\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp'
Write-Output '=== menu-board system ==='
Get-Content "$root\backend\menu-board-routes.js" -TotalCount 40 -Encoding UTF8
Write-Output ''
Write-Output '=== pos_products columns ==='
node -e "require('dotenv').config({path:process.cwd()+'/.env'});const {Pool}=require('pg');const p=new Pool({host:process.env.DB_HOST,port:5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});(async()=>{const c=(await p.query(`"SELECT column_name FROM information_schema.columns WHERE table_name='pos_products' ORDER BY ordinal_position`")).rows.map(r=>r.column_name);console.log(c.join(', '));const d=(await p.query(`"SELECT id, name_ar FROM pos_departments ORDER BY id`")).rows;console.log('الأقسام:',JSON.stringify(d));const n=(await p.query(`"SELECT COUNT(*)::int AS c FROM pos_products`")).rows[0].c;console.log('عدد الأصناف الحالي:',n);})().catch(e=>{console.error('ERR',e.message)}).finally(()=>p.end())"
