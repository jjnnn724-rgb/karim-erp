# KARIM ERP — تقرير الفهم العميق (المرحلة 2)
**التاريخ:** 2026-10-03 · **الوضع:** READ-ONLY · صفر تغييرات
**المرجع:** Enterprise 10/10 Master Directive — Stage 2 Deep Understanding
**المنهجية:** وكيلان مستقلان (مسارات المخزون / مسارات البيع-الإقفال-الرواتب) + تحقق مباشر SQL وقراءة كود للنواة المالية — كل ادعاء بدليل file:line

---

## 0. الحل الحاسم: لغز الدفتر الفارغ (أهم نتيجة)

**الحقائق المتسلسلة (بأدلة):**
1. `pos_orders` = **0 صفوف** — وحدة الكاشير المدمجة لم تسجّل أي بيع في الإنتاج قط. `pos_department_daily_revenues` = 0.
2. كل المبيعات الحقيقية (22,338 صف `revenues`، من 2026-09-08 إلى اليوم) مصدرها **مرآة Yarasoft** (`yarasoft/importer.js:406` — المصادر أسماء كاشير يارسوفت: كاشير 9/4/1/5/6، بيع خارجي).
3. مسار الاستيراد يكتب `revenues` **فقط ولا يستدعي postJournal إطلاقًا** — لا جسر من `revenues` (المستوردة) إلى GL.
4. مسارات الترحيل المبنية (12 نوع حدث، §2 أدناه) تعمل **للأحداث الأصلية لكاريم فقط** — والتي لم تُستخدم بعد إلا 2: **دفعا مورد** (`procurement-routes.js:771`).
5. القيدان الموجودان متوازنان تمامًا ومطابقان لدفعتَي الموردين (Dr 2000 / Cr 1000+1010).

**الاستنتاج:** المحرك المحاسبي **سليم ومبني جيدًا لكنه خامل** — لأن النشاط التجاري الفعلي (المبيعات) يمر عبر Yarasoft ولا يعبر إلى الدفتر. هذا **قرار معماري مطلوب من المالك في Stage 5**: (أ) تفعيل جسر ترحيل للإيرادات المستوردة، أو (ب) إبقاء GL للمعاملات الأصلية لكاريم فقط مع توثيق أن P&L التشغيلي يقرأ من `revenues` لا من GL.

**تحديث لتقرير سابق:** تقرير V6.0 وثّق "لا فحص فترة مغلقة في payroll-runs" — **القديم**: الكود الحالي يفحص (`hr-routes.js:523-531` + حراس CRUD `server.js:1541`). الوثّق هنا هو الصحيح.

---

## 1. مصدر الحقيقة لكل قيمة (SOURCE OF TRUTH MAP)

| القيمة | المصدر الموثوق | المشتقات/الإسقاطات | الملاحظة |
|---|---|---|---|
| رصيد المخزون | `inventory_location_balances.on_hand` (021:2-4 يصرح بذلك) | `inventory.qty` = إسقاط يُعاد حسابه بعد كل حركة (`inventory-ledger.js:122-127`) | ⚠️ تناقض C3: CRUD يقبل كتابة qty مباشرة |
| تكلفة الصنف | `inventory.avgCost` (متوسط موزون، يُعاد حسابه عند كل وارد) | `inventory_ledger.unit_cost/total_cost` (14,4/16,4) | `costing_policy` عمود ميت (fifo/fefo لا يُقرأ) |
| إيراد POS | `pos_orders` + `pos_invoice_payments` | `pos_department_daily_revenues` (trigger) + صف `revenues` بـ pos_order_id | P&L يستثني صفوف pos_order_id من `revenues` لمنع الازدواج (`finance-routes.js:20-23`) |
| إيراد مستورد | Yarasoft → `revenues` (pos_order_id NULL) | لا يمر بـ GL ولا بالـ rollup | فجوة الجسر |
| GL | `journal_entries/lines` (idempotent بـ UNIQUE (source_type, source_id) — 042:31) | كل التقارير تقرأ status='posted' | التوازن app-side فقط ±0.01 (لا قيد DB) |
| نقدية الصندوق | `pos_shift_sessions` (open/in/out) + `pos_day_closes` (Z) | قيد يومي تلقائي 6900/1000 عند فرق | سلسلة هاش فواتير + Z فريد |
| ذمم الموردين | `purchaseInvoices` + `supplier_payments` | GL 2000/1150/1200 عند الترحيل | حية — القيدان |
| رواتب | `payroll` (لكل موظف/شهر) + `payroll_runs` (PK=month) | قيد 6000/2200 يدوي عبر `/post-payroll` | ⚠️ لا UNIQUE (employeeId, month) — سباق توليد يمكن أن يكرر |
| حضور | `attendance` + `attendance_logs` (خام 50K) | قرارات/استنتاجات في `attendance_decisions` | خارج نطاق هذه المرحلة (غطّاه V6.0) |

---

## 2. المحاسبة — تدقيق معمّق

### 2.1 محرك الترحيل postJournal (`accounting-routes.js:62-171`) — سليم
فحوص بالترتيب: تاريخ صالح → **قفل فترة** (`assertPeriodOpen` :68) → تنظيف أسطر (مدين-أو-دائن فقط :81) → **توازن ±0.01** (:85) → **حسابات نشطة وقابلة للترحيل** (:87-91) → مراكز تكلفة صالحة → **idempotency** بمفتاح مصدر فريد (replay بدل تكرار :106-112) → ترقيم يومي تسلسلي بمحاولة تصادم (:43-56) → 3 محاولات قفل ميت.

### 2.2 خريطة أحداث الترحيل الـ 12 (الكل عبر نقطة واحدة — لا INSERT خام خارجها)
| الحدث | source_type | القيد | المستدعي |
|---|---|---|---|
| بيع كاشير | pos_sale | Dr 1000/1010 · Cr 4000+2100 | complete-sale.js:990 + إصلاح إقفال اليوم |
| إلغاء بيع | pos_void | عكس أعلاه | pos-orders-history.js:765 |
| شراء | purchase_invoice | Dr 1200+1150 · Cr 2000 | warehouse-routes.js:1767 |
| رصيد افتتاحي | purchase_invoice (OPEN-) | Dr 1200 · Cr 3000 | warehouse-routes.js:1767 |
| صرف مخزني قسم (COGS) | dispatch | Dr 5000 · Cr 1200 | warehouse-routes.js:672 |
| مرتجع مطبخ | kitchen_return | Dr 1200 · Cr 5000 | warehouse-routes.js:1040/1214 |
| دفعة مورد | supplier_payment | Dr 2000 · Cr 1000/1010 | procurement-routes.js:771 ✅ الحية الوحيدة |
| مصروف يدوي | expense | Dr 6900 · Cr 1000 | server.js:1176 (أُضيف 2026-10-02) |
| رواتب | payroll | Dr 6000 · Cr 2200 | /post-payroll (يدوي) |
| إقفال يوم | pos_day_close | فرق نقدية 6900/1000 | day-close-routes.js:260 |
| إهلاك | depreciation | Dr 6600 · Cr 1520 | accounting-growth.js:378 |
| يدوي | manual | حر | POST /journal |

### 2.3 الإقفال المحاسبي
- الإغلاق **علامة فقط** (`accounting_periods.closed=TRUE` — 079:28-35): لا لقطة أرصدة، لا تحقق اكتمال قيود الشهر قبل الإغلاق.
- **الجدول فارغ (0 فترات)** — القفل نائم عمليًا؛ كل التواريخ مفتوحة افتراضيًا.
- المسارات المحمية بالفحص: كل postJournal، JE void/approve، day-close، إهلاك، توليد رواتب + 5 كيانات رواتب CRUD، POS void.
- **مسارات بلا فحص**: complete-sale نفسها (بيع في شهر مغلق يكتب كل شيء ويُبتلع فشل قيده بصمت 990-991)، CRUD عام لـ `revenues`/`expenses`، إدراج `expenses` التشغيلية في المستودع (614/1012/1183/2532 — الصف يُحفظ رغم فشل قيده).

### 2.4 قيود القاعدة
`journal_entries`: CHECK status + UNIQUE (source_type, source_id) NULLS NOT DISTINCT + entry_no UNIQUE. `journal_lines`: NUMERIC(14,2) CHECK ≥0 + one-side CHECK. **لا قيد DB لتوازن الرأس** — اعتماد كامل على التطبيق (يُقترح constraint trigger لاحقًا في Stage 7).

---

## 3. المخزون — تدقيق معمّق (وكيل المسح 1)

### 3.1 مصدر الرصيد والتشتت
- الموثوق: `on_hand` لكل موقع؛ الإسقاط `inventory.qty` يُعاد حسابه مركزيًا.
- **القراءة مقسمة المصدر**: المستودع/لوحة/POS تقرأ `qty`، الجرد والمطبخ يقرآن `on_hand` — انسجام ظرفي بفضل إعادة الإسقاط بعد كل حركة، لكن أي كتابة bypass تكسره.

### 3.2 مركزية الحركة
`postInventoryLedgerEntry` (`inventory-ledger.js:30-129`) = خدمة مركزية حقيقية: idempotency key فريد + FOR UPDATE متدرج + رفض سالب + إدراج ledger + تحديث رصيد + إعادة إسقاط. **21 موقع استدعاء** تغطي: صرف/استلام/مرتجع/شراء/جرد/تحويلات/إنتاج/بيع POS/إلغاءات.
**5 مصادر تجاوز موثقة:** CRUD qty/avgCost (schema-registry.js:326-328) · مزامنة Oracle (oracle-catalog.js:139-162) · clear-all يمسح ledger ويعدل الأرصدة يدويًا (warehouse-routes.js:1961-1978) · حقول reservation/in_transit خارج الدفتر · seeding بلا قيد (ensureLocationBalance).

### 3.3 التكلفة
- متوسط موزون على avgCost عند كل وارد (5 مواضع بنفس الصيغة — تكرار مقصود لكنه هش) وعكسه عند إبطال فاتورة.
- COGS عند الصرف: Dr 5000/Cr 1200. **البيع POS لا يرحّل COGS** (§4 تناقض C1) — تكلفة المكونات تعيش في ledger.total_cost فقط.

### 3.4 السالب والقفل
- سياسة افتراضية `deny` + رفض صريح (`INSUFFICIENT_STOCK` 409) — لكن **لا CHECK على on_hand في القاعدة** (فقط reserved/in_transit ≥ 0) و`approval` قيمة ميتة (تتصرف كـ allow).
- كل المسارات: BEGIN/COMMIT + FOR UPDATE متدرج (مثال كامل موثق: موافقة صرف warehouse-routes.js:483→668) + POS بـ reserve-first idempotency وsemaphore 8 وstatement_timeout 120s.

### 3.5 الهالك/الجرد
- نوع `waste` معرف في الدفتر و**لا يستخدمه أحد** — الهالك modeled كـ waste_percent يضخم الاستهلاك (لا أثر مستقل).
- الجرد: variance يُطبق عند الاعتماد كـ count_correction + صف `expenses` للقسم — **بلا قيد GL** (على عكس dispatch الذي يرحّل).
- **تحويل الوحدات**: مطبق على استهلاك POS/إنتاج (بيع↔إلغاء متناظران) وغير مطبق على استلام/صرف المستودع (تساوي وحدة إجباري) — اتساق نصف-جهة مقصود.

### 3.6 التناقضات الثمانية (C1-C8 — مدخلات Stage 4)
1. **C1 COGS غير متماثل**: dispatch يرحّل COGS، بيع POS (يستهلك نفس المخزون) لا يرحّله.
2. **C2** `pos_products.stock_quantity` لا يُخصم أبدًا رغم تعليق الكود — للعرض فقط.
3. **C3** `inventory.qty` إسقاط معلن لكن CRUD يكتبه مباشرة → انحراف عن SUM(on_hand) حتى الحركة التالية.
4. **C4** clear-all يحذف صفوف ledger (خرق immutability المعلنة في 021:127).
5. **C5** ازدواج كتابة غير متماثل: dispatch-approve يكتب ledger+inventoryTx+expense، receive يكتب ledger فقط → استلامات المطبخ غير مرئية بشاشة inventoryTx.
6. **C6** سياسة `approval` ميتة.
7. **C7** مزامنة Oracle تكتب qty خارج النموذج (مخفف ببوابة qty=0).
8. **C8** الحجوزات (reserved/in_transit) غير قابلة لإعادة البناء من الدفتر — ledger replay لا يستنتجها.

---

## 4. البيع POS — المسار الكامل (وكيل المسح 2)

**20 خطوة موثقة بالأسطر** (complete-sale.js:383-1018): مصادقة + Idempotency-Key إجباري → semaphore 8 → معاملة واحدة (BEGIN→COMMIT في :972) تشمل: reserve-first idempotency (replay 201 عند ضياع الاستجابة، 409 عند تعارض الجسم) → قفل وردية/منتجات → BOM + تحويل وحدات + هالك → فحص مكونات 409 → **إجماليات server-side** + فحص نقص الدفع → إدراج أمر/بنود → استهلاك مكونات عبر المركزية (+fallback MAIN مسجل) → دفعات (trigger rollup) → **سلسلة هاش** تحت advisory lock → ZATCA QR توقيع ECDSA → طباعة/KOT كصفوف طابور → صف `revenues` (idempotent بفهرس جزئي 027:17-19) → outbox → COMMIT → بعده (غير قاتل): BullMQ ZATCA، **postSaleToLedger**، بث socket.

**أنماط فشل موثقة**: موت قبل COMMIT = رولباك كامل؛ موت بعد COMMIT قبل الترحيل = قيد مفقود **يُصلحه تلقائيًا** sweep الإقفال اليومي (234-248)؛ صف revenues قد يُتخطى بصمت (138-140) → انحراف P&L؛ طباعة/ZATCA لا تحجب البيع أبدًا (استثناء: خطأ بناء بايتات ESC/POS داخل المعاملة 823-827 سيُجهض البيع — نادٍ).

---

## 5. الإقفال اليومي والورديات
- Z-day: advisory lock + Z فريد + قفل جميع ورديات التاريخ FOR UPDATE + عدّ نقدي إجباري للورديات المفتوحة + بوابة فرق (428 يتطلب موافقة مدير فوق 50) + **إصلاح قيود ناقصة تلقائيًا** + قيد فرق idempotent. يمنع البيع لاحقًا عبر إغلاق الورديات (استثناء force:true للأدمن — ثغرة تشغيلية واعية).
- X-report = قراءة only. العد النقدي اليدوي متطلب تشغيلي موثق في القالب العربي بالواجهة.

## 6. الرواتب (الحالي — تصحيح لتقرير V6.0)
Basic = راتب شهري كامل (لا proration في المولد؛ salary/30 فقط في محرك خصومات التأخير) · OT اختياري بالساعة المستقيمة بلا مضاعف 1.5 · تخصيصات/خصومات/أقساط سلف (UNIQUE advance+month idempotent) · دائمًا 'posted' · **فحص فترة مغلقة موجود الآن** (523-531) + حارس CRUD · **لا UNIQUE (employeeId, month)** — سباق توليد متزامن قد يكرر (مخاطرة معروفة، توليد إداري نادر) · الترحيل اليدوي منصفحة CFO.

## 7. ZATCA
طابور داخل المعاملة + BullMQ مرآة + sweeper 5 دقائق + worker (SKIP LOCKED، backoff، dead_letter بعد 10) + استرجاع after-crash >15 دقيقة. الفشل لا يحجب البيع. التبليغ B2C simplified.

## 8. الضريبة والدقة العددية
- VAT 15% (tax_config صف واحد + fallback) · تقريب **per-line** (purchases عبر tax-rule-service بنصف-لأعلى صارم؛ POS عبر toFixed(2) لكل سطر — **اختلاف آليتين**) · إقرار IVA يقرأ 2100/1150 من الدفتر.
- **كل المبالغ NUMERIC — صفر float** (موثق بكل الأعمدة). عروض مختلطة (10,2/12,2/14,2) — اتساق مقترح في Stage 7.
- **5 دوال تقريب مختلفة** (r2/round2/roundMoney/Math.round/toFixed) — توحيد مستقبلي.

## 9. الأمان التشغيلي للمسارات (Authorization paths)
البيع: أدوار كاشير+ + shift ملكية + dept مطابقة · الإقفال: manager/admin فقط · الورديات: ملكية كاشير + إغلاق مركزي للمدير · الترحيل اليدوي: admin · حراسة CRUD عبر schema-registry لكل كيان/عملية + deny-first overlay · punch: قفل بصمة خاص.

---

## 10. بطاقة نهاية المرحلة (قالب التوجيه)

**STAGE:** 2 — Deep Understanding
**STATUS:** ✅ مكتملة (قراءة فقط)
**DISCOVERED:** محرك GL سليم خامل — المبيعات الفعلية (Yarasoft) بلا جسر للدفتر؛ POS داخلي = 0 استخدام؛ الفترات فارغة؛ 21 مسار مخزون مركزي + 5 تجاوزات؛ 8 تناقضات معمارية (C1-C8)؛ سلسلة البيع 20 خطوة بمعاملة واحدة وidempotency رباعية الطبقات؛ V6.0 stale في فحص فترة الرواتب (أُصلح منذ)
**CHANGED:** لا شيء
**DB:** لا ترحيل · Rollback: N/A · Verification: SQL مباشرة على journal/periods/COA/pos_orders
**Security:** مسارات مؤمّنة بأدوار + ملكية + قفل — لا ثغرة مصادقة جديدة اكتُشفت في هذه المسارات
**Financial Reconciliation:** لم تُنفذ (Stage 3) — الأدلة المهيئة: مصدر إيراد مزدوج (POS/Mirror) + GL خامل
**Inventory Reconciliation:** لم تُنفذ (Stage 3) — الأدلة المهيئة: 5 مسارات bypass قد تسبب انحراف qty/SUM(on_hand)
**Risks الجديدة:** C1-C8 (§3.6) + بيع في شهر مغلق بصمت + لا UNIQUE رواتب + 5 دوال تقريب
**Decisions:** 
1. اعتماد تقرير V6.0 محدثًا (payroll period-check أُصلح) — الدليل: hr-routes.js:523-531
2. جدولة «جسر Yarasoft→GL» كقرار مالك في Stage 5 (خياران موثقان في §0)
**Next Stage:** Stage 3 — Reality Testing على نسخة مستنسخة: توازن القيود، orphans، qty vs SUM(on_hand)، ازدواجية revenues، معاينة التزامن الفعلي (بيع أخير قطعة، دفع مزدوج)
