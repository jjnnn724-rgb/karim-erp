# وحدة الكاشير المؤسسية الذكية (OmniTrack POS) — دليل التكامل الكامل

> **الإصدار**: 1.0.0  |  **التاريخ**: 2026-07-16  |  **المعماري**: Senior Software Architect (Fintech)

## 📋 الفهرس

1. [نظرة عامة](#1-نظرة-عامة)
2. [الجداول الجديدة (14)](#2-الجداول-الجديدة)
3. [الـ Triggers (8)](#3-الtriggers)
4. [الـ RLS Policies](#4-rls-policies)
5. [API Endpoints](#5-api-endpoints)
6. [تدفق عملية البيع الكامل](#6-تدفق-عملية-البيع)
7. [ZATCA Phase-2 Compliance](#7-zatca-phase2-compliance)
8. [الطباعة الحرارية ESC/POS](#8-الطباعة-الحرارية)
9. [الأمان والصلاحيات](#9-الأمان-والصلاحيات)
10. [ضبط الأداء](#10-ضبط-الأداء)
11. [العمليات الخلفية](#11-العمليات-الخلفية)
12. [استكشاف الأخطاء](#12-استكشاف-الأخطاء)

---

## 1. نظرة عامة

وحدة الكاشير المؤسسية مُدمَجة بالكامل في نظام karim ERP القائم دون كسر أي وظيفة موجودة. الاستراتيجية:

- **جداول جديدة بادئة `pos_`** (لا تتعارض مع `users`, `inventory`, `departments` القائمة)
- **ربط FK** مع `users(id)` و `departments(code)` و `inventory(id)` الموجودة
- **Trigger مزامنة**: عند تحديث `inventory`، يُحدَّث `pos_products` المرتبط تلقائياً
- **Views للتكامل**: `v_pos_cashier_dashboard` للوحات المعلومات
- **Connection pool مُشتَرَك**: وحدة الكاشير تستخدم نفس pool من `server.js` (لا pool مزدوج)
- **Auth متوافق**: JWT يدعم كلمات مرور plaintext (القائمة) + bcrypt (الترقية المستقبلية)

### المخرجات الرئيسية

| المكون | المسار | الوصف |
|---|---|---|
| **Migration SQL** | `database/migrations/003_cashier_module.sql` | 14 جدول، 6 ENUMs، 8 triggers، RLS، stored procs، ZATCA TLV |
| **Backend Module** | `backend/cashier-module/` | 14 ملف JS |
| **Frontend** | `frontend/app/pos.html` + `css/pos.css` + `js/pos.js` | واجهة كاشير كاملة |
| **Migration Runner** | `database/scripts/run-migration.js` | سكريبت تطبيق أي ملف SQL |
| **Workers** | `backend/cashier-module/zatca-worker.js`, `print-worker.js` | عمليات ZATCA + الطباعة الخلفية |

### واجهة البيع في V2

واجهة V2 المدمجة مفعّلة للبيع للأدوار المصرح بها عبر `salesEnabled` في `frontend/app/js/v2/preview.js`، مع الإبقاء على شاشة الكاشير المستقلة كمسار احتياطي. تستخدم الواجهة مسارات الخادم المعتمدة للورديات والبيع والطباعة، وتوزع الخصومات على بنود الفاتورة قبل إرسالها كي يعيد الخادم حساب الضرائب والإجماليات. يتضمن سجل الفواتير إعادة الطباعة، بينما يقتصر إلغاء الفاتورة على المدير/المسؤول مع سبب إلزامي ويعكس المخزون والإيراد من خلال الخادم.

تطبيق POS V2 المستقل متاح على `/app/cashier/` ويعرض تسجيل الدخول والكاشير فقط دون تحميل تنقّل ERP؛ ويمكن تثبيته كتطبيق PWA. هذا مسار موازٍ للاختبار والتأهيل، وليس بعدُ مسار التشغيل الإنتاجي الرسمي. زر الكاشير في ERP يبقى على `/app/pos.html` إلى أن يكتمل إثبات تكافؤ الوظائف والاختبار الميداني واعتماد تحويل المستخدمين. يفتح رابط داخل V2 تطبيق الكاشير المستقل. لا تُحوّل أو تحذف صفحة POS القديمة قبل اعتماد الترحيل. يخزّن عامل الخدمة غلاف التطبيق والملفات الثابتة فقط؛ بيانات الجلسة والكتالوج والبيع لا تعمل دون اتصال ولا تُخزّن في Cache API.

وصفات المطعم هي مصدر أصناف المنيو: يزامن مسار قراءة أصناف POS الوصفات إلى `pos_products` مع ربط القسم والسعر والتكلفة، من دون المساس بالباركود أو الصورة أو مكونات الوصفة. وتُحدّث شاشة الكاشير المفتوحة عند بث تغييرات الوصفات أو أصناف POS؛ حذف الوصفة يؤرشف صنفها المرتبط بدل حذف سجلات البيع السابقة.

تعرض شاشة الكاشير أصناف القسم كبطاقات لمسية تشمل الصورة والاسم والسعر والباركود والمخزون. يستطيع المدير أو المسؤول رفع صورة JPG أو PNG أو WEBP حتى 5 ميجابايت من البطاقة نفسها؛ تُحدّث الصورة في القائمة مباشرة بعد نجاح الحفظ، ولا ينشئ رفعها فاتورة أو حركة مخزون.

تخطيط التطبيق المستقل متجاوب مع أحجام الشاشات: بطاقات المنتجات مضغوطة لتظهر أصنافًا أكثر على شاشات POS واللوحات الواسعة، مع تقليل مساحة الصورة والأيقونة مع بقاء اسم الصنف وسعره مقروءين؛ تعرض الهواتف عمودين بحد أدنى مناسب للمس. تبقى السلة في لوحة قابلة للتمرير بجانب القائمة على الشاشات الواسعة، وتنتقل إلى تخطيط عمودي على الشاشات الأصغر. يتغير رقم نسخة التنسيق وعامل الخدمة عند تحديث التخطيط حتى تُحمّل النسخة الجديدة بدل كاش قديم.

**قبل أول وردية فعلية:** سجّل الدخول بحساب الكاشير، افتح وردية اختبارية بإشراف المسؤول، وتحقق عمليًا من توفر الطابعة وإخراج إيصال نقدي وفتح الدرج تلقائيًا، ومن وصول تذكرة المطبخ إن كانت مفعلة. مسار البيع يضيف الطباعة إلى الطابور؛ لا تعتبر الإيصال مطبوعًا لمجرد ظهور رقم مهمة الطباعة. لا توجد حاليًا واجهة لفتح الدرج يدويًا من V2، وفتح الدرج التلقائي يعتمد على الطابعة المسجلة والعاملة. لا تُجرَ كتابة إلى يارا سوفت.

---

## 2. الجداول الجديدة

كل الجداول مُسماة بـ `pos_*` لعزلها عن الجداول القائمة.

### 2.1 `pos_departments`
أقسام الـ POS (ماليزي، مشاوي، قهوة). مرتبطة بـ `departments(code)` القائمة عبر `legacy_dept_code`.

### 2.2 `pos_products`
منتجات الـ POS. مرتبطة بـ `inventory(id)` القائمة عبر `legacy_inventory_id`. **Trigger المزامنة** يُحدّث الـ stock تلقائياً عند تحديث `inventory`.

### 2.3 `pos_shift_sessions` ❤️ جوهر إدارة الورديات
- `opening_balance`: مبلغ العهدة عند الفتح
- `expected_cash`: **GENERATED STORED** = `opening_balance + Σ(cash_in) - Σ(cash_out)`
- `actual_cash`: المبلغ الفعلي عند الإغلاق
- `cash_variance`: **GENERATED STORED** = `actual_cash - expected_cash` (العجز/الزيادة)
- يسمح بـ **جلسات متعددة متزامنة** لنفس القسم (كاشير 1 و 2 في القسم الماليزي)

### 2.4 `pos_orders` (UUID PK)
الفواتير — مع حقول ZATCA Phase-2:
- `invoice_counter`, `invoice_uuid`, `previous_invoice_hash`, `invoice_hash`
- `digital_signature` (ECDSA P-256), `qr_payload` (Base64 TLV)
- قيد فريد `UNIQUE(department_id, invoice_counter)` لمنع التكرار

### 2.5 `pos_order_items`
بنود الفاتورة مع snapshot (السعر، الباركود، الاسم) للحفاظ على سلامة السجل التاريخي.

### 2.6 `pos_invoice_payments`
تفكيك الدفع المجزأ. `direction='in'` للبيع، `'out'` للاسترجاع.

### 2.7 `pos_department_daily_revenues`
تجميع يومي حسب (القسم + طريقة الدفع). يُحدَّث تلقائياً عبر trigger للتوفيق البنكي السريع.

### 2.8 `pos_idempotency_keys`
مفتاح Idempotency بصلاحية 24h + هاش الـ body لاكتشاف تلاعب الـ payload.

### 2.9 `pos_zatca_invoice_queue`
مرآة SQL لطابور BullMQ. توفر متانة: حتى لو فُقِد Redis، يمكن للـ sweeper إعادة الجدولة.

### 2.10 `pos_pending_prints`
طابور طباعة offline-first مع Exponential Backoff.

### 2.11 `pos_printers`
سجل الطابعات الحرارية (USB/Network/Serial/Windows Share).

### 2.12 `pos_audit_logs` 🔒
سجل تدقيق **Append-Only** — منع UPDATE/DELETE بـ trigger + `REVOKE TRUNCATE`.

### 2.13 `pos_stock_movements`
سجل حركة المخزون (append-only) للمراجعة المحاسبية.

### 2.14 `pos_refresh_tokens`
JWT refresh tokens مشفرة بـ SHA-256، مع دوران واسترجاع.

---

## 3. الـ Triggers

| الـ Trigger | الجدول | الوظيفة |
|---|---|---|
| `trg_pos_products_touch` | pos_products | تحديث `updated_at` |
| `trg_pos_orders_touch` | pos_orders | تحديث `updated_at` |
| `trg_pos_chain_invoice_hash` | pos_orders | تخصيص `invoice_counter` + حساب `invoice_hash` عبر **Advisory Lock** |
| `trg_pos_route_revenue` | pos_invoice_payments | تحديث `pos_department_daily_revenues` فورياً |
| `trg_pos_prevent_audit_update` | pos_audit_logs | منع UPDATE |
| `trg_pos_prevent_audit_delete` | pos_audit_logs | منع DELETE |
| `trg_pos_audit_*` | pos_orders, pos_shift_sessions, pos_order_items, pos_invoice_payments | تسجيل تلقائي في `pos_audit_logs` |
| `trg_pos_capture_stock_movement` | pos_products | تسجيل في `pos_stock_movements` |
| `trg_pos_recompute_totals` | pos_order_items | إعادة حساب `subtotal/tax_total/total_amount` |
| `trg_pos_sync_from_inventory` | inventory (legacy) | مزامنة `pos_products` عند تحديث `inventory` |

---

## 4. RLS Policies

### سياق المستخدم (عبر GUCs)
يتم تمرير هوية المستخدم عبر `SET LOCAL app.user_id`, `app.user_role` في كل معاملة. الدوال المساعدة:

- `fn_pos_is_privileged()` → true إذا كان admin/manager/auditor/bg_worker
- `fn_pos_accessible_dept_ids()` → مصفوفة أقسام المستخدم النشطة

### السياسات
- **Cashier**: يرى/يعدّل فقط فواتير جلساته المفتوحة في قسمه
- **Admin/Manager/Auditor/bg_worker**: معفون من RLS
- ينطبق على: `pos_orders`, `pos_order_items`, `pos_invoice_payments`, `pos_shift_sessions`, `pos_pending_prints`, `pos_stock_movements`, `pos_department_daily_revenues`

---

## 5. API Endpoints

### المصادقة
| Method | Path | الوصف |
|---|---|---|
| POST | `/api/auth/login` | تسجيل دخول → access + refresh tokens |

### المبيعات
| Method | Path | Headers | الوصف |
|---|---|---|---|
| POST | `/api/sales/complete` | `Authorization`, `Idempotency-Key` | إتمام بيع ذري مجزأ |

### الورديات
| Method | Path | الوصف |
|---|---|---|
| POST | `/api/pos/shifts/open` | فتح وردية (يستدعي `sp_pos_open_shift`) |
| POST | `/api/pos/shifts/:id/close` | إغلاق مع حساب العجز/الزيادة |
| GET | `/api/pos/shifts/active` | وردية الكاشير النشطة |
| GET | `/api/pos/shifts/:id/summary` | ملخص الوردية (مبيعات نقدية/بطاقة/محفظة) |

### الكتالوج
| Method | Path | الوصف |
|---|---|---|
| GET | `/api/pos/departments` | قائمة الأقسام النشطة |
| GET | `/api/pos/products?department_id=` | قائمة المنتجات |

### المراقبة
| Method | Path | الوصف |
|---|---|---|
| GET | `/api/pos/dashboard` | KPIs الكاشير النشط (View) |
| GET | `/metrics` | Prometheus metrics |

---

## 6. تدفق عملية البيع

```
POST /api/sales/complete
├─ 1. jwtAuth → التحقق من JWT + استخراج cashier
├─ 2. requireRole('cashier','manager','admin')
├─ 3. التحقق من Idempotency-Key header
├─ 4. validateSalePayload(body)
└─ 5. BEGIN TRANSACTION
   ├─ SET LOCAL app.user_id, app.user_role, ...  (RLS context)
   ├─ SELECT ... FROM pos_idempotency_keys WHERE key=$1 FOR UPDATE
   │   ├─ key + same hash → COMMIT, return cached 201
   │   └─ key + diff hash → ROLLBACK, return 409
   ├─ Resolve cashier's OPEN pos_shift_sessions
   ├─ SELECT ... FROM pos_products WHERE id = ANY(...) FOR UPDATE  🔒
   ├─ Stock sufficiency check
   ├─ computeTotalsServerSide()  (لا تثق بالـ client)
   ├─ INSERT pos_orders (status='draft')
   ├─ INSERT pos_order_items (batched)
   ├─ SELECT fn_pos_decrement_stock_atomic()  (trigger logs movement)
   ├─ INSERT pos_invoice_payments (split)
   │   └─ trigger trg_pos_route_revenue → pos_department_daily_revenues
   ├─ UPDATE pos_orders SET status='issued'
   │   └─ trigger trg_pos_chain_invoice_hash:
   │       ├─ pg_advisory_xact_lock(7331, dept_id)  🔒
   │       ├─ read previous invoice_hash
   │       ├─ allocate invoice_counter = max+1
   │       └─ compute invoice_hash = SHA-256(canonical)
   ├─ buildZatcaTlvInJs()  (Base64 TLV)
   ├─ signInvoice()  (ECDSA P-256)
   ├─ UPDATE pos_orders SET qr_payload, digital_signature
   ├─ buildEscPosReceipt() → INSERT pos_pending_prints
   ├─ INSERT pos_zatca_invoice_queue (status='queued')
   ├─ INSERT pos_idempotency_keys (24h cached response)
   └─ COMMIT
└─ 6. Post-commit (outside txn):
   ├─ enqueueZatcaReporting() → BullMQ (or SQL queue if SKIP_BULLMQ=1)
   └─ io.to('dept:N').emit('sale:completed')
```

---

## 7. ZATCA Phase-2 — بنية تحتية جاهزة للتكامل

> **⚠️ حالة حالية**: البنية التحتية جاهزة للتكامل مع ZATCA، لكنها **غير متصلة فعليًا ببوابة فاتورة** بعد.
> 
> الميزات المُنفَّذة: حساب الـ hash chain داخلياً، توليد QR TLV، التوقيع الرقمي ECDSA، طابور إرسال غير متزامن.
> 
> الميزات الناقصة (مطلوبة للإنتاج الفعلي): انظر [قائمة المهام الناقصة](#قائمة-المهام-الناقصة-للتكامل-الكامل)

### سلسلة الهاش (Hash Chaining) — مُنفَّذة داخلياً
```
For each new invoice in department D:
  1. pg_advisory_xact_lock(7331, D.id)     ← serializes counter allocation
  2. prev_hash = SELECT invoice_hash FROM pos_orders
                 WHERE department_id = D.id
                 ORDER BY invoice_counter DESC LIMIT 1
  3. invoice_counter = (prev_counter || 0) + 1
  4. canonical = invoice_uuid || counter || total || tax || subtotal || discount || iso_ts
  5. invoice_hash = SHA-256(canonical)    ← stored as hex
  6. previous_invoice_hash = prev_hash    ← link to chain
```

### QR TLV (Base64)
7 حقول بتشفير TLV (Tag-Length-Value):
| Tag | الحقل |
|---|---|
| 1 | اسم البائع (عربي) |
| 2 | الرقم الضريبي (VAT) |
| 3 | الطابع الزمني UTC ISO 8601 |
| 4 | الإجمالي (شامل الضريبة) |
| 5 | إجمالي الضريبة |
| 6 | الرقم التسلسلي |
| 7 | UUID |

### التوقيع الرقمي
- **الخوارزمية**: ECDSA-P256-SHA256 (NIST P-256)
- **الـ Payload الموقَّع**: `SHA-256( invoice_hash || invoice_uuid || counter )`
- **الصيغة**: Base64(DER)
- **تخزين المفتاح**: في الإنتاج، استخدم HSM/KMS. في التطوير، استخدم `ZATCA_ECDSA_PRIVATE_KEY_B64`.

### الرفع غير المتزامن
- BullMQ (Redis) مع `attempts: 10`, `backoff: exponential(2s)`
- DLQ بعد استنفاد المحاولات
- **Sweeper cron** كل 5min يُعيد جدولة المهام المعلقة من SQL mirror (ضمان المتانة)
- إذا لم يكن Redis متاحاً، ضع `SKIP_BULLMQ=1` وسيستخدم النظام **SQL polling** كل 10s

### قائمة المهام الناقصة للتكامل الكامل

> هذه المهام مطلوبة للاتصال الفعلي ببوابة فاتورة ZATCA والامتثال لـ Phase-2:

| # | المهمة | الحالة | الأولوية |
|---|--------|--------|----------|
| 1 | **توليد CSR** (Certificate Signing Request) للمفتاح ECDSA | ❌ لم يُنفَّذ | حرجة |
| 2 | **طلب Compliance CSID** من بوابة فاتورة sandbox/production | ❌ لم يُنفَّذ | حرجة |
| 3 | **إكمال buildZatcaUblXml()** — بناء XML UBL 2.1 كامل (حاليًا stub) | ❌ لم يُكتمل | حرجة |
| 4 | **توقيع XML** بالـ Compliance CSID (XML Digital Signature) | ❌ لم يُنفَّذ | حرجة |
| 5 | **الإرسال الفعلي** لـ `/invoices` مع mutual TLS (mTLS) | ⚠️ جزئي | حرجة |
| 6 | **معالجة استجابة Clearance/Reporting** وتحديث حالة الفاتورة | ⚠️ جزئي | عالية |
| 7 | **اختبار end-to-end** مع بيئة ZATCA sandbox | ❌ لم يُنفَّذ | عالية |

### ملاحظة تقنية مهمة
دالة `buildZatcaUblXml()` في `zatca-worker.js` حاليًا تُرجع XML مبسط (stub). الرفع الفعلي سيفشل حتى تُكتمل البنود 3-5 أعلاه.

---

## 8. الطباعة الحرارية

### ESC/POS 80mm
- **العرض**: 48 حرف/سطر (Font A 12x24)
- **الترميز**: UTF-8 (يدعم العربية)
- **القياسات**: init → header → items → totals → payment → QR → footer → cut

### QR Code
- بروتوكول ESC/POS `GS ( k`
- Model 2, Error Correction M (15%), Module Size 6
- البيانات = Base64 TLV payload

### Offline-First Queue
- كل إيصال يُحفَظ في `pos_pending_prints` (BYTEA)
- `print-worker.js` يستقصي كل 2s
- **Exponential Backoff**: 2s → 4s → 8s → ... → 5min cap
- **SKIP LOCKED** للتشغيل المتوازي (عديد workers)
- بعد `max_attempts` (8): status → `abandoned`

### أنواع الاتصالات المدعومة
| النوع | المثال |
|---|---|
| network | TCP إلى IP:port (default 9100) |
| windows_share | `\\server\share` (via `lpr`) |
| usb | يتطلب `escpos-usb` (TODO) |
| serial | TODO |

---

## 9. الأمان والصلاحيات

### JWT
- **Access Token**: HS256, 15min
- **Refresh Token**: opaque UUID, 7d, مُخزَّن SHA-256 في `pos_refresh_tokens`
- **دوران**: كل refresh يُصدِر زوجاً جديداً + يُبطِل القديم

### RBAC
| الدور | الصلاحيات |
|---|---|
| admin | كل شيء |
| manager | كل شيء ما عدا إدارة المستخدمين |
| cashier | فقط قسمه النشط (RLS) |
| auditor | قراءة فقط + سجلات التدقيق |
| bg_worker | معفى من RLS (للـ workers) |

### كلمات المرور
- **متوافق مع البنية القائمة**: كلمات plaintext (الموجودة في `users.password`)
- **ترقية اختيارية**: إذا بدأ الـ hash بـ `$2a$` أو `$2b$` → bcrypt compare
- مستقبلًا: migration لتشفير كل كلمات المرور بـ bcrypt

### Rate Limiting (Token Bucket)
- `POST /api/sales/complete`: 60 req/min per cashier
- `POST /api/auth/login`: 5 req/min per IP
- `POST /api/pos/shifts/open`: 5 req/min per cashier

---

## 10. ضبط الأداء

### شرط الأداء
**p95 ≤ 200ms تحت 50 كاشير متزامن**

### إعدادات `postgresql.conf` الإنتاجية
```conf
max_connections = 200
shared_buffers = 2GB                  # 25% من RAM
effective_cache_size = 6GB            # 75% من RAM
work_mem = 16MB
maintenance_work_mem = 512MB
wal_buffers = 64MB
max_wal_size = 4GB
random_page_cost = 1.1                # SSD-tuned
effective_io_concurrency = 200
synchronous_commit = on               # مطلوب للمعاملات المالية
```

### إعدادات DB Pool (في `.env`)
```
DB_POOL_MAX=30      # 1.5x expected concurrent cashiers
DB_POOL_MIN=5       # always-warm connections
```

### اختبار الحمل
```bash
# Install: npm i -g autocannon
autocannon -c 50 -d 60 -m POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -b '{"department_id":1,"items":[{"product_id":1,"quantity":1,"unit_price":10}],"payments":[{"method":"cash","amount":11.5}]}' \
  http://localhost:5000/api/sales/complete
```

### مراقبة Prometheus
```bash
curl http://localhost:5000/metrics | grep pos_complete_sale
```
الكلمات المفتاحية:
- `pos_complete_sale_duration_ms{quantile="0.95"}` → p95
- `pos_complete_sale_total{result="..."}` → counters

---

## 11. العمليات الخلفية

### ZATCA Worker
```bash
npm run zatca-worker
# أو
node backend/cashier-module/zatca-worker.js
```
- **BullMQ mode** (افتراضي إذا Redis متاح): concurrency = 5
- **SQL polling mode** (إذا `SKIP_BULLMQ=1`): يستقصي كل 10s
- يكتب النتيجة لـ `pos_zatca_invoice_queue` و`pos_orders.zatca_reported_at`

### Print Worker
```bash
npm run print-worker
# أو
node backend/cashier-module/print-worker.js
```
- يستقصي `pos_pending_prints` كل 2s
- `SKIP LOCKED` للتوازي
- Exponential backoff على الفشل

### إعدادات systemd (Linux)
```ini
# /etc/systemd/system/omnitrack-zatca-worker.service
[Unit]
Description=OmniTrack ZATCA Worker
After=network.target redis.service postgresql.service

[Service]
Type=simple
User=omnitrack
WorkingDirectory=/opt/karim-erp-system
ExecStart=/usr/bin/node backend/cashier-module/zatca-worker.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/karim-erp-system/.env

[Install]
WantedBy=multi-user.target
```

---

## 12. استكشاف الأخطاء

### "NO_OPEN_SHIFT" عند محاولة البيع
- السبب: الكاشير لم يفتح وردية
- الحل: `POST /api/pos/shifts/open` أولاً

### "SHIFT_ALREADY_OPEN" عند فتح وردية
- السبب: الكاشير لديه وردية مفتوحة سابقة
- الحل: أغلق الوردية القديمة أولاً، أو استخدم `X-Shift-Session-Id` header

### "INSUFFICIENT_STOCK"
- السبب: كمية المطلوبة > المتوفر في `pos_products.stock_quantity`
- الحل: تحقق من المخزون أو أعد تعبئته من `inventory`

### "IDEMPOTENCY_KEY_CONFLICT" (409)
- السبب: استخدمت نفس Idempotency-Key مع body مختلف
- الحل: استخدم key جديد لكل عملية بيع جديدة

### "ZATCA chain requires department_id"
- السبب: الـ order ليس له `department_id`
- الحل: تأكد أن `body.department_id` مُمرَّر في الطلب

### الفواتير لا تُرفَع لـ ZATCA
- تحقق: `SELECT status, count(*) FROM pos_zatca_invoice_queue GROUP BY status;`
- إذا `failed`: راجع `last_error`
- إذا `queued` لفترة طويلة: شغّل `npm run zatca-worker`
- لإعادة جدولة يدوية: `UPDATE pos_zatca_invoice_queue SET status='queued', next_retry_at=NOW() WHERE status='failed';`

### الإيصالات لا تُطبَع
- تحقق: `SELECT status, count(*) FROM pos_pending_prints GROUP BY status;`
- تأكد أن `pos_printers.is_online = true`
- شغّل `npm run print-worker`

### token منتهي (401 TOKEN_EXPIRED)
- السبب: انتهت صلاحية access token (15min)
- الحل: طلب `/api/auth/login` مجدداً (أو نفذ `/api/auth/refresh` لاحقاً)

---

## 📚 مراجع

- [ZATCA e-Invoicing Portal](https://zatca.gov.sa/ar/e-invoicing/)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/14/ddl-rowsecurity.html)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [ESC/POS Command Reference](https://escpos.readthedocs.io/)
- [ECDSA P-256 (NIST)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf)

---

**نُسخة الوثيقة**: 1.0.0  |  **آخر تحديث**: 2026-07-16
