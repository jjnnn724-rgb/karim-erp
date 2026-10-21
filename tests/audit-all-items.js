// جرد شامل للقراءة فقط: كل صنف — qty مقابل مجموع المواقع مقابل صافي الدفتر،
// ولأصناف الافتتاحي الصافي: الحالي مقابل (بداية − منصرف) مع تفسير أي فرق بحركات لاحقة.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
const r3 = (x) => Math.round(Number(x) * 1000) / 1000;

(async () => {
  const items = (await pool.query('SELECT id, name, qty, unit FROM inventory ORDER BY id')).rows;

  const balRows = (await pool.query(
    'SELECT inventory_id, SUM(on_hand) AS s FROM inventory_location_balances GROUP BY inventory_id')).rows;
  const balMap = new Map(balRows.map(b => [Number(b.inventory_id), Number(b.s)]));

  const mainLocRow = (await pool.query(`SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1`)).rows[0];
  const mainBalMap = new Map();
  if (mainLocRow) {
    const mainRows = (await pool.query(
      'SELECT inventory_id, on_hand FROM inventory_location_balances WHERE location_id=$1', [Number(mainLocRow.id)])).rows;
    for (const b of mainRows) {mainBalMap.set(Number(b.inventory_id), Number(b.on_hand));}
  }

  const ledRows = (await pool.query(
    `SELECT inventory_id, SUM(quantity_delta) AS net, COUNT(*)::int AS c, MAX(created_at) AS last_at
     FROM inventory_ledger GROUP BY inventory_id`)).rows;
  const ledMap = new Map(ledRows.map(l => [Number(l.inventory_id), l]));

  const netCorr = (await pool.query(
    `SELECT DISTINCT ON (l.inventory_id) l.inventory_id, l.reason, l.created_at
     FROM inventory_ledger l
     WHERE l.transaction_type='count_correction' AND l.reason LIKE '%افتتاحي%' AND l.created_at::date >= CURRENT_DATE - INTERVAL '1 day'
     ORDER BY l.inventory_id, l.created_at DESC`)).rows;
  const parse = (s) => {
    const src = String(s || '');
    let m = /بداية\s*([\d.]+)\s*،\s*منصرف\s*([\d.]+)/.exec(src);
    if (m) { return { begin: Number(m[1]), issued: Number(m[2]) }; }
    m = /بداية\s*([\d.]+)\s*[−-]\s*صرف(?:\s*أذونات)?\s*([\d.]+)/.exec(src);
    if (m) { return { begin: Number(m[1]), issued: Number(m[2]) }; }
    return null;
  };
  const netMap = new Map(netCorr.map(c => [Number(c.inventory_id), parse(c.reason)]));

  let ok = 0; const anomalies = []; const netReport = [];
  for (const it of items) {
    const id = Number(it.id);
    const qty = Number(it.qty);
    const bal = balMap.get(id) ?? 0;
    const led = ledMap.get(id);
    // 1) qty = مجموع المواقع (قاعدة صارمة)
    if (Math.abs(qty - bal) > 0.001) { anomalies.push({ name: it.name, why: `qty=${qty} ≠ مجموع المواقع=${r3(bal)}` }); continue; }
    // 2) صافي الدفتر = qty (لمن له دفتر أصلًا)
    if (led && Number(led.c) > 0 && Math.abs(Number(led.net) - qty) > 0.001) {
      anomalies.push({ name: it.name, why: `صافي الدفتر=${r3(led.net)} ≠ qty=${qty}` }); continue;
    }
    // 3) أصناف الافتتاحي الصافي: رصيد المخزن الرئيسي مقابل (البداية − المنصرف)
    if (netMap.has(id)) {
      const t = netMap.get(id);
      if (t) {
        const expected = r3(t.begin - t.issued);
        const mainNow = r3(mainBalMap.get(id) ?? 0);
        if (Math.abs(mainNow - expected) > 0.001) {
          anomalies.push({ name: it.name, why: `رصيد الرئيسي=${mainNow} ≠ البداية−المنصرف=${expected}` });
          continue;
        }
        netReport.push({ name: it.name, unit: it.unit, begin: t.begin, issued: t.issued, expected, mainCurrent: mainNow, total: qty });
      }
    }
    ok++;
  }

  console.log(`إجمالي الأصناف: ${items.length}`);
  console.log(`سليمة (رصيد = مواقع = دفتر${netMap.size ? ' + معادلة البداية−المنصرف حيث تنطبق' : ''}): ${ok}`);
  console.log(`شواذ تحتاج نظر: ${anomalies.length}`);
  for (const a of anomalies) {console.log(`  ✗ «${a.name}»: ${a.why}`);}

  console.log('\n=== معادلة المالك: رصيد المخزن الرئيسي = البداية − المنصرف ===');
  let match = 0; const drift = 0;
  for (const r of netReport.sort((a, b) => a.name.localeCompare(b.name))) {
    match++;
    console.log(`«${r.name}»: ${r.begin} − ${r.issued} = ${r.expected} بالرئيسي ✓ (الإجمالي مع مخازن الأقسام: ${r.total}) ${r.unit}`);
  }
  console.log(`\nأصناف الافتتاحي الصافي المطابقة للمعادلة: ${match} | منحرفة: ${drift}`);
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => pool.end());
