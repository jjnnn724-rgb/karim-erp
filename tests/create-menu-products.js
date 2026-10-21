// إنشاء أصناف المطبخ بالصور الحقيقية + ربط صورة الكبسة الموجودة
// الأسعار تبقى 0 — المالك يضعها من «إدارة المنيو» (محرر الأسعار الجديد)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\u00a0\t]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

const DISHES = [
    { name: 'كبسة دجاج', image: '/img/pos/kabsa-chicken.jpg', exists: true },
    { name: 'كبسة لحم', image: '/img/pos/kabsa-meat.jpg' },
    { name: 'برياني دجاج', image: '/img/pos/biryani-chicken.jpg' },
    { name: 'ربع دجاجة مشوية مع الأرز', image: '/img/pos/grilled-chicken-quarter.jpg' },
    { name: 'نصف دجاجة مشوية مع الأرز', image: '/img/pos/grilled-chicken-half.jpg' },
    { name: 'دجاجة مشوية كاملة مع الأرز', image: '/img/pos/grilled-chicken-whole.jpg' },
    { name: 'أيدام', image: '/img/pos/aedam-mezze.jpg' },
    { name: 'شوربة عدس', image: '/img/pos/lentil-soup.jpg' },
    { name: 'مكرونة بشاميل', image: '/img/pos/macarona-bechamel.jpg' },
];
const DEPT_ID = 9; // المطبخ — نفس قسم «كبسة دجاج» التي أنشأها المالك
const META = JSON.stringify({ managed_in: 'pos', catalog_scope: 'menu' });

(async () => {
  const existing = (await pool.query('SELECT id, name_ar, image_url FROM pos_products')).rows;
  const byKey = new Map(existing.map(i => [norm(i.name_ar), i]));
  let created = 0, updated = 0;
  for (const d of DISHES) {
    const k = norm(d.name);
    const row = byKey.get(k);
    if (row) {
      if (!row.image_url && d.image) {
        await pool.query('UPDATE pos_products SET image_url=$2, updated_at=NOW() WHERE id=$1', [row.id, d.image]);
        console.log(`✓ صورة للصنف الموجود «${row.name}» (#${row.id}) → ${d.image}`);
        updated++;
      } else {
        console.log(`موجود بصورة — تخطي «${row.name}»`);
      }
      continue;
    }
    const r = await pool.query(
      `INSERT INTO pos_products (name_ar, department_id, price, cost_price, vat_rate, stock_quantity, min_stock_level, is_active, category, unit, metadata, image_url)
       VALUES ($1,$2,0,0,15.00,0,0,true,'غداء','طبق',$3::jsonb,$4) RETURNING id`,
      [d.name, DEPT_ID, META, d.image]);
    console.log(`✓ أُنشئ «${d.name}» (#${r.rows[0].id}) — السعر 0 (تضعه من إدارة المنيو)`);
    created++;
  }
  const fin = (await pool.query(`SELECT id, name_ar, price, image_url FROM pos_products WHERE image_url IS NOT NULL ORDER BY id`)).rows;
  console.log(`\n=== أصناف بالصور الآن: ${fin.length} (أُنشئ ${created}، حُدّث ${updated}) ===`);
  for (const f of fin) {console.log(`  #${f.id} «${f.name_ar}» ${f.image_url}`);}
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => pool.end());
