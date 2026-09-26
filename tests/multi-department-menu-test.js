const { Client } = require('pg');
const base = 'http://127.0.0.1:5700';
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
}
async function main() {
  const db = new Client({ host:'127.0.0.1', port:5432, database:'karim_erp_preview', user:'karim_preview', password:'karim_preview_local' });
  await db.connect();
  try {
    const login = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ username:'admin', password:'1234' }) });
    if (login.status !== 200) {throw new Error(`login ${login.status}`);}
    const token = login.json.access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const product = (await db.query("SELECT id,name_ar,name_en,barcode,price,cost_price,vat_rate,is_active,category,unit FROM pos_products WHERE id=5")).rows[0];
    if (!product) {throw new Error('product 5 missing');}
    const update = await api(`/api/pos/products/${product.id}`, { method:'PUT', headers, body: JSON.stringify({ ...product, price:Number(product.price), cost_price:product.cost_price === null ? null : Number(product.cost_price), vat_rate:Number(product.vat_rate), department_ids:[1,5], department_id:1, stock_quantity:0, min_stock_level:0 }) });
    if (update.status !== 200) {throw new Error(`update ${update.status} ${JSON.stringify(update.json)}`);}
    for (const departmentId of [1,5]) {
      const result = await api(`/api/pos/products?department_id=${departmentId}`, { headers });
      const found = result.json?.find((p) => Number(p.id) === 5);
      if (result.status !== 200 || !found) {throw new Error(`not visible in department ${departmentId}`);}
    }
    const links = await db.query('SELECT department_id FROM pos_product_departments WHERE product_id=5 ORDER BY department_id');
    console.log(JSON.stringify({ ok:true, product_id:5, departments:links.rows.map((r)=>Number(r.department_id)) }));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
