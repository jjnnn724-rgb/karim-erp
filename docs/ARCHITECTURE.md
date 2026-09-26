# Architecture — karim ERP v2.1.0

> **تاريخ آخر تحديث:** 2026-07-17
> **يحلّ محل:** `docs/MIGRATION-STATE.md` (الذي كان بحالة "قيد التحليل")

---

## 1. نظرة عامة على المعمارية

karim ERP هو تطبيق سطح مكتب (Electron 28) يضمّ داخله:
- خادم **Express 5** على المنفذ 5000
- قاعدة بيانات **PostgreSQL 16** (Portable على Windows)
- اتصالات فورية عبر **Socket.io** للبث اللحظي للأجهزة على الشبكة المحلية
- واجهة ويب (HTML/CSS/JS) تُخدَم من `/app/`

```
┌─────────────────────────────────────────────┐
│  Electron Main Process (electron/main.js)   │
│  ├── يبدأ PostgreSQL Portable               │
│  ├── يبدأ Express server (backend/server.js)│
│  └── يفتح BrowserWindow على localhost:5000  │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│ Express 5 API   │   │ PostgreSQL 16   │
│ /api/*          │◀──│ karim_erp DB    │
│ + Socket.io     │   │ 35+ جدول        │
└────────┬────────┘   └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│ Frontend (frontend/app/)                    │
│ index.html (إدارة) + pos.html (كاشير)       │
│ JS: app.js, pos.js, realtime.js, scanner.js │
└─────────────────────────────────────────────┘
```

---

## 2. حالة الهجرة من app_state JSON blob

### الهدف
ترحيل الوحدات الأربع الأهم (orders, menu_items, tables, kitchen_orders) من JSON blob واحد في `app_state` إلى جداول علائقية حقيقية.

### الحالة الحالية (2026-07-17)

| الوحدة | الحالة | الجدول العلائقي | Endpoints REST |
|--------|--------|------------------|----------------|
| **orders** | ✅ **مُهاجرة بالكامل** | `orders` + `order_items` (migration 008) | `CRUD /api/orders` |
| **inventory** | ✅ **مُهاجرة سابقاً** | `inventory` (migration 001) | `CRUD /api/inventory` + `POST /api/inventory/import` |
| **purchaseInvoices** | ✅ **مُهاجرة سابقاً** | `purchaseInvoices` (migration 001) | `CRUD /api/purchaseInvoices` |
| **menu_items** | ⏳ **عبر app_state** | — | — |
| **tables** | ⏳ **عبر app_state** | — | — |
| **kitchen_orders** | ⏳ **عبر app_state** | — | — |

### معيار القبول لـ orders (مُثبت فعلياً)
```bash
# 1. endpoint علائقي مُسجّل
curl -s http://localhost:5000/api/orders
# → 401 (jwtAuth يعمل) — يعني endpoint موجود ويتطلب مصادقة

# 2. جدول orders في migration 008
grep "CREATE TABLE.*orders" database/migrations/008_orders_relational.sql
# → CREATE TABLE IF NOT EXISTS orders (...)
```

### الفاتورة المرنة (ميزة 2026-07-17)
في `frontend/app/js/app.js` دالة `savePurchaseInvoice()`:
- **قبل** (سطر 2057): `if(!invItem){ toast('الصنف غير موجود','error'); return; }` — الفاتورة تُرفض بالكامل
- **بعد** (سطر 2058-2077): `if(!invItem){ invItem = { id:uid(), name:item.itemName, qty:0, ... }; STATE.inventory.push(invItem); autoCreated.push(invItem.name); }` — الصنف يُنشأ تلقائياً

كذلك في `backend/cashier-module/orders-routes.js` (endpoint REST):
- `order_items.product_id BIGINT` (nullable)
- `order_items.inventory_id BIGINT` (nullable)
- خيار `auto_create_inventory: true` يُنشئ صنف مخزون جديد عند الطلب

---

## 3. الأمان

### المصادقة
- **JWT** (access 15m + refresh 7d) عبر `backend/cashier-module/jwt-middleware.js`
- **bcrypt فقط** — لا مقارنة نصية لكلمات المرور (تم إزالة الفرع النصي بالكامل)
- **8 أدوار**: admin, manager, cashier, auditor, warehouse, kitchen, hr, employee

### الحماية
- **Schema whitelist** (`backend/schema-registry.js`) — يمنع identifier injection
- **Rate limiting** (4 طبقات: general/auth/state/crud)
- **CORS موحّد** — REST و Socket.io يقرآن من نفس `ALLOWED_ORIGINS`
- **API_KEY** اختياري + تحذير صريح عند الفراغ
- **Graceful shutdown** (30s timeout)
- **Audit logging** عبر RLS GUC + `pos_audit_logs`

---

## 4. قاعدة البيانات

### الجداول الرئيسية (migration 001-008)
- **001_schema.sql** — 18 جدول (users, employees, inventory, departments, ...)
- **002_seed.sql** — 5 مستخدمين افتراضيين
- **003_cashier_module.sql** — 14+ جدول POS + إجراءات مخزّنة
- **004_password_migration.sql** — عمود `password_migrated_at`
- **005_pagination_indexes.sql** — فهارس للأداء
- **006_demo_seed.sql** — بيانات تجريبية واقعية
- **007_force_bcrypt_passwords.sql** — فهرس للكشف عن كلمات المرور غير المُهاجرة
- **008_orders_relational.sql** — جداول `orders` + `order_items` (جديد)

### سكربت الهجرة الإجباري
```bash
node scripts/migrate-plaintext-passwords.js
```
يهش كل كلمات المرور النصية بـ bcrypt (12 rounds). يجب تشغيله قبل أول إقلاع للإنتاج.

---

## 5. الـ Endpoints

### مصادقة
- `POST /api/auth/login` — يرجّع access_token + refresh_token

### state (legacy — سيُزال تدريجياً)
- `GET/POST/DELETE /api/state` — JSON blob لكل الحالة

### CRUD علائقي (لكل كيان)
- `/api/users`, `/api/employees`, `/api/inventory`, `/api/departments`, ...
- يدعم pagination + sorting عبر `?page=1&limit=20&sort=created_at&order=desc`

### POS (OmniTrack)
- `POST /api/sales/complete` — بيع ذرّي مع Idempotency-Key
- `GET /api/pos/departments`, `/api/pos/products`, `/api/pos/dashboard`
- `POST /api/pos/shifts/open`, `POST /api/pos/shifts/:id/close`

### Orders (جديد)
- `GET/POST/PUT/DELETE /api/orders` — فاتورة مرنة (تقبل أصنافاً غير موجودة)

### استيراد Excel
- `POST /api/inventory/import` — استيراد من JSON أو CSV
- `GET /api/inventory/import/template` — قالب CSV

---

## 6. الـ Frontend

### الملفات
- `frontend/app/index.html` — الصفحة الرئيسية (إدارة)
- `frontend/app/pos.html` — واجهة الكاشير
- `frontend/app/js/app.js` — منطق الإدارة (4500+ سطر)
- `frontend/app/js/pos.js` — منطق الكاشير
- `frontend/app/js/realtime.js` — اتصال Socket.io
- `frontend/app/js/scanner.js` — QR/باركود

### آلية الحفظ
- `saveData()` — debounced 250ms + coalescing + retry (3 محاولات exponential backoff)
- `loadData()` — تحميل كامل STATE من `/api/state`
- `sendBeacon` عند إغلاق الصفحة لضمان الحفظ

### الفاتورة المرنة
- `savePurchaseInvoice()` في app.js — تنشئ أصنافاً غير موجودة تلقائياً
- `importBulkInventory()` — استيراد Excel عبر SheetJS
- `showBulkInventoryImportModal()` — نافذة معاينة قبل الاستيراد

---

## 7. ZATCA Phase-2 — الحالة الفعلية

**بنية تحتية جاهزة، غير مفعّلة بعد.**

تم بناء كل المكونات التقنية لكن لم يتم الاتصال الفعلي بخوادم ZATCA.

### المهام الناقصة
1. توليد CSR من ZATCA portal
2. طلب Compliance CSID من Sandbox
3. إكمال `buildZatcaUblXml()` في `backend/cashier-module/zatca-queue.js`
4. توقيع XML بالشهادة
5. الإرسال عبر mTLS
6. معالجة الاستجابة
7. اختبار end-to-end

راجع `docs/CASHIER-MODULE.md` للتفاصيل الكاملة.

---

## 8. التشغيل على Windows

### المتطلبات
- Windows 10/11 (64-bit)
- Node.js 18+
- 4GB RAM كحد أدنى

### التشغيل
```cmd
:: الطريقة الأسهل
Karim-ERP-Launcher.bat
:: → اختر [1] Setup (أول مرة)
:: → اختر [2] Run

:: بعد Setup، شغّل سكربت الهجرة الإجباري
node scripts/migrate-plaintext-passwords.js
```

### اللانشر المضاد للرصاص
- **preflight checks** — فحص Node + npm + صلاحيات الكتابة
- **log file** — كل خطأ يُسجّل في `%TEMP%\karim-launcher.log`
- **safe mode** — خيار [9] لتشغيل بدون auto-migrations
- **pause دائماً** — النافذة لا تُغلق أبداً عند الخطأ

راجع `README-WINDOWS.md` للتفاصيل.
