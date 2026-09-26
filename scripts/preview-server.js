#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Karim ERP v4 — Preview / Mock server
   Serves the redesigned frontend with realistic demo data so the
   UI can be verified without PostgreSQL. NOT part of production.
   Usage: node scripts/preview-server.js [port]
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'frontend', 'app');
const PORT = Number(process.argv[2] || 8899);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

/* ─────────────── Demo data ─────────────── */
const today = new Date();
const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() - offset); return x.toISOString().slice(0, 10); };
const id = () => Math.floor(Math.random() * 1e9);

const departments = [
  { id: 1, name: 'المطبخ الرئيسي', code: 'KITCH-01', icon: 'chef-hat' },
  { id: 2, name: 'قاعة الطعام', code: 'HALL-01', icon: 'utensils' },
  { id: 3, name: 'المشروبات', code: 'BEV-01', icon: 'coffee' },
  { id: 4, name: 'المخبز والمعجنات', code: 'BAKE-01', icon: 'bread' },
];
const deptIcons = { chef: '👨‍🍳', hall: '🍽️', bev: '☕', bake: '🫓' };

const inventory = [
  { id: 1, name: 'أرز بسمتي فاخر', code: 'RICE-001', qty: 240, minQty: 50, unit: 'كجم', avgCost: 8.5, weight: 240 },
  { id: 2, name: 'دجاج مجمد', code: 'CHK-001', qty: 85, minQty: 40, unit: 'كجم', avgCost: 14.2, weight: 85 },
  { id: 3, name: 'لحم غنم طازج', code: 'MTN-001', qty: 32, minQty: 35, unit: 'كجم', avgCost: 52, weight: 32 },
  { id: 4, name: 'زيت ذرة', code: 'OIL-001', qty: 96, minQty: 30, unit: 'لتر', avgCost: 11, weight: 96 },
  { id: 5, name: 'بهارات مشكلة', code: 'SPC-001', qty: 18, minQty: 20, unit: 'كجم', avgCost: 34, weight: 18 },
  { id: 6, name: 'أقماع آيس كريم', code: 'IC-001', qty: 480, minQty: 100, unit: 'حبة', avgCost: 0.6, weight: 12 },
  { id: 7, name: 'حبوب قهوة مختصة', code: 'COF-001', qty: 44, minQty: 15, unit: 'كجم', avgCost: 68, weight: 44 },
  { id: 8, name: 'حليب طازج', code: 'MLK-001', qty: 130, minQty: 60, unit: 'لتر', avgCost: 5.5, weight: 130 },
];
const revenues = [];
for (let i = 1; i <= 34; i++) {
  revenues.push({ id: i, deptId: departments[i % 4].code, amount: 1500 + Math.round(Math.random() * 5200), date: d(i % 12), source: ['مبيعات نقدي', 'مبيعات شبكة', 'طلبات خارجية', 'حجوزات'][i % 4], notes: '' });
}
const expenses = [];
for (let i = 1; i <= 26; i++) {
  expenses.push({ id: i, deptId: departments[i % 4].code, amount: 300 + Math.round(Math.random() * 1900), date: d(i % 12), category: ['مشتريات', 'رواتب', 'صيانة', 'خدمات'][i % 4], notes: '' });
}
const dispatches = [
  { id: 1, deptId: 1, status: 'pending', date: d(0), notes: 'طلب صرف للمطبخ الرئيسي', items: [{ name: 'أرز بسمتي', qty: 25, unit: 'كجم' }, { name: 'دجاج', qty: 15, unit: 'كجم' }] },
  { id: 2, deptId: 3, status: 'approved', date: d(1), notes: 'مواد المشروبات', items: [{ name: 'حليب', qty: 40, unit: 'لتر' }] },
  { id: 3, deptId: 2, status: 'received', date: d(2), notes: 'مستهلكات القاعة', items: [{ name: 'مناديل', qty: 50, unit: 'علبة' }] },
];
const recipes = [
  { id: 1, name: 'كبسة دجاج', category: 'أطباق رئيسية', portions: 4, cost: 22.5, price: 45, deptId: 1, components: [{ name: 'أرز', qty: 1, unit: 'كجم' }, { name: 'دجاج', qty: 1.2, unit: 'كجم' }] },
  { id: 2, name: 'شوربة عدس', category: 'شوربات', portions: 6, cost: 9, price: 18, deptId: 1, components: [{ name: 'عدس', qty: 0.8, unit: 'كجم' }] },
];
const employees = [
  { id: 1, employeeId: 'EMP-101', name: 'خالد المطيري', position: 'رئيس طهاة', department: 'المطبخ الرئيسي', salary: 6200, status: 'active', phone: '0551234567' },
  { id: 2, employeeId: 'EMP-102', name: 'سامي العتيبي', position: 'كاشير', department: 'قاعة الطعام', salary: 4200, status: 'active', phone: '0559876543' },
  { id: 3, employeeId: 'EMP-103', name: 'أحمد حسن', position: 'أمين مخزن', department: 'المخبز والمعجنات', salary: 5100, status: 'active', phone: '0561112233' },
  { id: 4, employeeId: 'EMP-104', name: 'يوسف القحطاني', position: 'باريستا', department: 'المشروبات', salary: 4300, status: 'leave', phone: '0564445566' },
];
const attendance = [
  { id: 1, employeeId: 1, date: d(0), checkIn: '08:02', checkOut: '17:05', status: 'present' },
  { id: 2, employeeId: 2, date: d(0), checkIn: '08:14', checkOut: '17:02', status: 'present' },
  { id: 3, employeeId: 3, date: d(0), checkIn: '', checkOut: '', status: 'absent' },
];
const leaveRequests = [
  { id: 1, employeeId: 4, type: 'إجازة سنوية', from: d(2), to: d(-4), status: 'pending', notes: 'طلب إجازة اعتيادية' },
];
const users = [
  { id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: true },
  { id: 2, username: 'cashier1', name: 'سامي العتيبي', role: 'cashier', active: true },
];
const notifications = [
  { id: 1, title: 'مخزون منخفض', message: 'اللحم الغنم وصل الحد الأدنى', type: 'warning', date: new Date().toISOString(), read: false },
  { id: 2, title: 'وردية جديدة', message: 'تم فتح وردية الكاشير المسائية', type: 'info', date: new Date().toISOString(), read: true },
];
const shelves = [{ id: 1, name: 'رف A1 — جافة', deptId: 1, items: [{ name: 'أرز', qty: 240 }, { name: 'بهارات', qty: 18 }] }];
const weightReadings = [];
const inventoryTx = [];
const purchaseInvoices = [];
const kitchenReturns = [];
const hrDepartments = [{ id: 1, name: 'المطبخ', manager: 'خالد المطيري', headcount: 12 }];
const leaveTypes = [{ id: 1, name: 'سنوية', days: 21 }, { id: 2, name: 'مرضية', days: 30 }];
const payroll = [{ id: 1, employeeId: 1, month: today.toISOString().slice(0, 7), base: 6200, deductions: 0, net: 6200, status: 'draft' }];

const DB = { departments, revenues, expenses, inventory, inventoryTx, dispatches, recipes, purchaseInvoices, kitchenReturns, employees, attendance, leaveRequests, hrDepartments, leaveTypes, payroll, shelves, weightReadings, notifications, users };
const settings = { id: 'main_settings', name: 'مطاعم الشرفه العالمي', logo: 'karim', logoB64: null, currency: 'SAR', lowStockAlert: true, workStartHour: 9 };


/* ── POS-specific mock endpoints ── */
const posDepartments = [
  { id: 1, name_ar: 'المطبخ الرئيسي', name_en: 'Main Kitchen' },
  { id: 2, name_ar: 'قاعة الطعام', name_en: 'Dining Hall' },
  { id: 3, name_ar: 'المشروبات', name_en: 'Beverages' },
];
const posProducts = [
  { id: 1, name_ar: 'كبسة دجاج', category: 'وجبات رئيسية', price: 28, stock_quantity: 40, min_stock_level: 5, ingredient_count: 3, is_active: true, department_id: 1, barcode: '6281000001' },
  { id: 2, name_ar: 'مندي لحم', category: 'وجبات رئيسية', price: 45, stock_quantity: 22, min_stock_level: 5, ingredient_count: 3, is_active: true, department_id: 1, barcode: '6281000002' },
  { id: 3, name_ar: 'شاورما عربي', category: 'وجبات رئيسية', price: 18, stock_quantity: 3, min_stock_level: 5, ingredient_count: 4, is_active: true, department_id: 1, barcode: '6281000003' },
  { id: 4, name_ar: 'شوربة عدس', category: 'شوربات', price: 9, stock_quantity: 60, min_stock_level: 10, ingredient_count: 2, is_active: true, department_id: 1, barcode: '6281000004' },
  { id: 5, name_ar: 'فتوش', category: 'مقبلات', price: 12, stock_quantity: 25, min_stock_level: 5, ingredient_count: 3, is_active: true, department_id: 1, barcode: '6281000005' },
  { id: 6, name_ar: 'حمص بالطحينة', category: 'مقبلات', price: 10, stock_quantity: 30, min_stock_level: 5, ingredient_count: 2, is_active: true, department_id: 1, barcode: '6281000006' },
  { id: 7, name_ar: 'قهوة عربية', category: 'مشروبات ساخنة', price: 8, stock_quantity: 80, min_stock_level: 10, ingredient_count: 0, is_active: true, department_id: 3, barcode: '6281000007' },
  { id: 8, name_ar: 'شاي أخضر', category: 'مشروبات ساخنة', price: 6, stock_quantity: 90, min_stock_level: 10, ingredient_count: 0, is_active: true, department_id: 3, barcode: '6281000008' },
  { id: 9, name_ar: 'عصير ليمون', category: 'مشروبات غازية', price: 11, stock_quantity: 35, min_stock_level: 8, ingredient_count: 0, is_active: true, department_id: 3, barcode: '6281000009' },
  { id: 10, name_ar: 'كنافة بالجبن', category: 'حلويات', price: 16, stock_quantity: 12, min_stock_level: 4, ingredient_count: 2, is_active: true, department_id: 1, barcode: '6281000010' },
];

function paginate(rows, q) {
  const page = Math.max(1, Number(q.get('page') || 1));
  const limit = Math.max(1, Number(q.get('limit') || 200));
  const start = (page - 1) * limit;
  const data = rows.slice(start, start + limit);
  return { data, pagination: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) } };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // Socket.io stub — realtime module stays dormant in preview mode
  if (p === '/socket.io/socket.io.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('window.io = function(){ return { on(){}, emit(){}, connected:true, disconnect(){} }; };');
    return;
  }

  if (p.startsWith('/api/')) {
    const route = p.slice(5); // after /api/
    if (route === 'health') {return json(res, 200, { status: 'ok', ok: true, mode: 'preview', connectedClients: 1, checks: { database: { status: 'healthy', latency: '2ms' } } });}
    if (route === 'auth/login' && req.method === 'POST') {
      return json(res, 200, { access_token: 'preview-token', user: { id: 1, username: 'admin', role: 'admin', name: 'مدير النظام' } });
    }
    if (route === 'state') {return json(res, 200, { lang: 'ar', theme: 'light' });}
    if (route === 'settings/main_settings') {
      if (req.method === 'GET') {return json(res, 200, settings);}
      let body = ''; req.on('data', c => body += c); req.on('end', () => { try { Object.assign(settings, JSON.parse(body || '{}')); } catch (e) {} return json(res, 200, settings); });
      return;
    }
    if (route === 'pos/departments') {return json(res, 200, posDepartments);}
    if (route === 'pos/products') {return json(res, 200, posProducts);}
    if (route.match(/^pos\/products\/\d+\/ingredients$/)) {return json(res, 200, []);}
    if (route === 'pos/ingredients') {return json(res, 200, inventory);}
    if (route === 'pos/held-orders') {return json(res, 200, []);}

    /* ── POS orders history mocks (v4.5 visual verification) ── */
    const posOrderDepts = ['المطبخ الرئيسي', 'قاعة الطعام', 'المشروبات'];
    const posOrderCatalog = [
      { name: 'كبسة دجاج', price: 28 }, { name: 'مندي لحم', price: 45 },
      { name: 'شاورما عربي', price: 18 }, { name: 'شوربة عدس', price: 9 },
      { name: 'قهوة عربية', price: 8 }, { name: 'كنافة بالجبن', price: 16 },
    ];
    const posPayMethods = ['cash', 'card', 'wallet'];
    const posOrders = Array.from({ length: 14 }, (_, i) => {
      const created = new Date(today.getTime() - (i * 37 + 12) * 60000).toISOString();
      const items = Array.from({ length: 1 + (i % 3) }, (_, k) => {
        const it = posOrderCatalog[(i + k * 2) % posOrderCatalog.length];
        const qty = 1 + ((i + k) % 2);
        return { product_name: it.name, quantity: qty, unit_price: it.price, discount: 0, line_total: it.price * qty };
      });
      const gross = items.reduce((s, it) => s + it.line_total, 0);
      const subtotal = Math.round((gross / 1.15) * 100) / 100;
      const tax = Math.round((gross - subtotal) * 100) / 100;
      const method = posPayMethods[i % 3];
      return {
        id: 9000 + i, invoice_counter: 141 - i, department_name: posOrderDepts[i % 3],
        created_at: created, status: i === 4 || i === 9 ? 'voided' : 'issued',
        cashier_name: i % 2 ? 'سامي العتيبي' : 'خالد المطيري',
        subtotal, tax_total: tax, discount_total: 0, total_amount: gross,
        payments: [{ method, amount: gross, reference: method === 'card' ? 'POS-8842' : null }],
        void_reason: i === 4 ? 'خطأ في إدخال الطلب' : i === 9 ? 'إرجاع من العميل' : null,
        items,
      };
    });
    if (route === 'pos/orders/stats/today') {
      const issued = posOrders.filter(o => o.status === 'issued');
      const revenue = issued.reduce((s, o) => s + o.total_amount, 0);
      const byMethod = {};
      issued.forEach(o => { const m = o.payments[0].method; byMethod[m] = byMethod[m] || { method: m, total: 0, count: 0 }; byMethod[m].total += o.total_amount; byMethod[m].count++; });
      return json(res, 200, {
        summary: { total_revenue: Math.round(revenue * 100) / 100, orders_count: posOrders.length, avg_order_value: Math.round((revenue / issued.length) * 100) / 100, issued_count: issued.length },
        payment_breakdown: Object.values(byMethod),
        recent_orders: posOrders.slice(0, 6).map(({ id: oid, invoice_counter, department_name, total_amount, created_at, status }) => ({ id: oid, invoice_counter, department_name, total_amount, created_at, status })),
      });
    }
    if (route === 'pos/orders/item-summary') {
      const rows = posOrderCatalog.map((c, i) => ({ product_name: c.name, product_barcode: '628100000' + (i + 1), departments: posOrderDepts[i % 3], invoice_count: 6 - (i % 4), quantity_sold: 9 - i, net_sales: c.price * (9 - i), tax_total: Math.round(c.price * (9 - i) * 0.15 * 100) / 100, produced_qty: i < 4 ? 8 : 0, planned_qty: i < 4 ? 8 : 0 }));
      return json(res, 200, { data: rows, summary: { quantity_sold: rows.reduce((s, r) => s + r.quantity_sold, 0), invoice_count: 14, net_sales: rows.reduce((s, r) => s + r.net_sales, 0) } });
    }
    if (route === 'pos/orders/export') {return json(res, 200, { data: posOrders });}
    if (route === 'pos/orders') {return json(res, 200, paginate(posOrders, url.searchParams));}
    if (route.match(/^pos\/orders\/\d+$/)) {
      const found = posOrders.find(o => String(o.id) === route.split('/')[2]);
      return found ? json(res, 200, found) : json(res, 404, { message: 'الفاتورة غير موجودة' });
    }
    if (route === 'pos/shifts/active') {return json(res, 404, { message: 'no active shift' });}
    if (route === 'pos/shifts/open' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => { const body = JSON.parse(b || '{}'); json(res, 200, { opened_at: new Date().toISOString(), status: 'open', ...body, id: id(), session_id: id() }); });
      return;
    }
    if (route === 'sales/complete' && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => json(res, 200, { order_id: id(), invoice_number: 'INV-' + Date.now() % 10000, total: 100, qr: null, ...JSON.parse(b || '{}') }));
      return;
    }
    const [entity, entityId] = route.split('/').map(x => x.split('?')[0]);
    if (DB[entity]) {
      if (req.method === 'GET' && !entityId) {return json(res, 200, paginate(DB[entity], url.searchParams));}
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => body += c); req.on('end', () => {
          try { const row = JSON.parse(body || '{}'); row.id = id(); row.icon = row.icon && deptIcons[row.icon] ? row.icon : row.icon; DB[entity].push(row); return json(res, 200, row); } catch (e) { return json(res, 400, { message: 'bad json' }); }
        });
        return;
      }
      if ((req.method === 'PUT' || req.method === 'DELETE') && entityId) {
        let body = ''; req.on('data', c => body += c); req.on('end', () => {
          const idx = DB[entity].findIndex(r => String(r.id) === String(entityId));
          if (req.method === 'DELETE') { if (idx >= 0) {DB[entity].splice(idx, 1);} return json(res, 200, { ok: true }); }
          if (idx >= 0) { try { Object.assign(DB[entity][idx], JSON.parse(body || '{}')); } catch (e) {} }
          return json(res, 200, idx >= 0 ? DB[entity][idx] : { ok: true });
        });
        return;
      }
    }
    return json(res, 200, { data: [], pagination: { page: 1, limit: 200, total: 0, totalPages: 1 } });
  }

  // static files
  let file = p === '/' ? '/index.html' : p;
  file = decodeURIComponent(file).replace(/\.\./g, '');
  if (file === '/app/pos.html') {file = '/pos.html';}
  if (file.startsWith('/app/')) {file = file.slice(4);}
  const fp = path.join(WEB, file);
  if (!fp.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + file); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`Karim ERP preview → http://localhost:${PORT}`));
