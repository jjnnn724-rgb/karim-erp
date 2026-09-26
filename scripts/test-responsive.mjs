import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFile(new URL(relative, root), 'utf8');

const [indexHtml, posHtml, styles, posStyles, appJs, posJs, serverJs, cashierMigration] = await Promise.all([
  read('frontend/app/index.html'),
  read('frontend/app/pos.html'),
  read('frontend/app/css/styles.css'),
  read('frontend/app/css/pos.css'),
  read('frontend/app/js/app.js'),
  read('frontend/app/js/pos.js'),
  read('backend/server.js'),
  read('database/migrations/003_cashier_module.sql'),
]);

assert.match(indexHtml, /<meta\s+name="viewport"\s+content="width=device-width/i, 'الإدارة بلا viewport متجاوب');
assert.match(posHtml, /<meta\s+name="viewport"\s+content="width=device-width/i, 'الكاشير بلا viewport متجاوب');
assert.match(styles, /@media\s*\(max-width:\s*900px\)[\s\S]*\.sidebar\.mobile-open/, 'لا يوجد تخطيط شريط جانبي للهاتف');
assert.match(styles, /@media\s*\(max-width:\s*520px\)[\s\S]*#content/, 'لا يوجد تخطيط شاشة صغيرة للمحتوى');
assert.match(posStyles, /#pos-screen\.mobile-cart-open\s+\.cart-section/, 'سلة الهاتف غير قابلة للفتح');
assert.match(posStyles, /\.btn-complete\{[^}]*position:sticky/s, 'زر الدفع ليس مثبتًا داخل مساحة الدفع');
assert.match(appJs, /window\.matchMedia\('\(max-width: 900px\)'\)/, 'زر القائمة لا يملك وضع الهاتف');
assert.match(appJs, /classList\.toggle\('mobile-open'\)/, 'فتح الشريط الجانبي للهاتف غير مربوط');
assert.match(posJs, /loadDepartments|loadProducts|apiFetch|fetch\(/, 'الكاشير لا يقرأ من API');
assert.doesNotMatch(appJs, /JSON\.stringify\(STATE\)/, 'الواجهة ما زالت ترسل STATE التشغيلية كاملة');
assert.doesNotMatch(appJs, /Object\.assign\(STATE,data\)/, 'استيراد JSON ما زال يكتب الحالة المحلية بدل PostgreSQL');
assert.match(appJs, /showDatabaseRestoreInfo\(\)/, 'إرشادات استعادة قاعدة البيانات غير موجودة');
assert.match(appJs, /uiPreferencesPayload\(\)/, 'حفظ تفضيلات الواجهة غير معزول');
assert.match(serverJs, /Business entities must use their own PostgreSQL tables/, 'الخادم لا يعلن عزل app_state');
assert.doesNotMatch(cashierMigration, /Seed: default pos_departments|INSERT INTO pos_products/, 'ترحيل الكاشير يزرع بيانات تشغيلية افتراضية');

console.log('Responsive and PostgreSQL-source structural test: PASS');
console.log('Checked: admin viewport, POS viewport, mobile sidebar, content breakpoints, mobile cart, sticky checkout, API-backed POS wiring.');
