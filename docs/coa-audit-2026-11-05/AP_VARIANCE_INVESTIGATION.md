# 15. AP_VARIANCE_INVESTIGATION.md — حزمة تحقيق الانحراف −706,091.83 (لم تُنفذ — تحتاج موافقتك/Dump)

## السياق المؤكد من الكود
- عرض المطابقة `view_ap_reconciliation` (132) يقارن: ذمم الموردين = `Σ(totalAmount − paidAmount)` **للفواتير غير الملغاة فقط** في `purchaseInvoices` (لا يشمل `suppliers.openingBalance` ولا يرى أي فاتورة لم تُدخل في كريم ERP) مقابل `Σ(credit − debit)` لسطور `journal_entries/lines` على حساب **2000** بحالة posted.
- النتيجة الحية: subledger = **50,251.51** · GL = **756,343.34** · الفرق = **−706,091.83**.
- القيد المعياري لشراء: Dr 1200 (net) + Dr 1150 (VAT) / Cr 2000 (gross) — مصدر `purchase_invoice` (`postPurchaseToLedger`).
- القيد المعياري لدفعة: Dr 2000 / Cr 1000 أو 1010 — مصدر `supplier_payment`.
- **القيدان best-effort**: أي فشل (423 فترة مقفولة، خطأ شبكة، إلخ) يُسجَّل تحذيرًا فقط ولا يُدخل القيد — `logger.warn("[payment_ledger] best-effort skipped")` (`procurement-routes.js:788`). هذا مولّد انحراف أساسي.
- الإلغاء (`purchase-void-routes` / `procurement-routes` void) **يحذف صلبًا** القيد/الدفعات ولا يعكس — يزيد GL تفاوتًا بعد كل إلغاء (حذف قيد دفعة ينقص debit من GL بينما `paidAmount` في الفاتورة قد لا يُعاد حسابه بأثر رجعي).
- فواتير الأرصدة الافتتاحية (`OPEN-`): تُرخّل على Cr 3000 (ليس 2000) بمفتاح المصدر نفسه `purchase_invoice` — مشروعة، ولا تُفسد المطابقة إلا عبر آلية مختلفة (إن دخلت كـ paid أو total).

## الأسئلة الحاكمة التي تحدد نطاق التحقيق (قرار مالك)
1. هل كريم ERP هو المصدر الفعلي لكل مشتريات الشركة أم **جزء منها** (الذي لا يزال يمر بـ YaraSoft/الورق)؟ إن كان جزئيًا، فانحراف المطابقة **متوقع ببنيته** والحل هو وثيقة سياسة: "مطابقة AP تُجرى على الفواتير المُسجلة في كريم فقط، شهريًا، مع تقرير فجوات" — لا "تصحيح دفتر".
2. هل يُعتمد رقم 2000 في GL كمرجع لـ AP الشركة، أم رقم YaraSoft لـ AP الكامل؟
3. ما الذي تتقبله لجنة المراجعة كـ "Zero variance حقيقي"؟ (المقترح: مطابقة شهرية + تسويات مفسَّرة معتمدة، لا صفر تجميلي.)

## ما أحتاجه منك (من غير أي وصول للإنتاج)
أ) **Dump معزول** للجداول التالية (إلى مسار على جهازك، CSV أو .dump — بلا بيانات اعتماد/أسرار):
   - `"purchaseInvoices"` (الأعمدة: id, invoiceNumber, date, supplierId, supplierName?، subtotal_net, vat_total, totalAmount, paidAmount, paymentStatus, createdAt) — **كامل التاريخ، كل الصفوف**.
   - `supplier_payments` (كامل) · `suppliers` (id, name, "openingBalance").
   - `journal_entries` + `journal_lines` للنطاق 2026-09-01 → اليوم (حجمها صغير: ~36 ألف قيد في 5 أسابيع) أو مرشحًا: الحسابات 1150/1200/2000/2010/2020/2030/2040/3000/4000/5000 — **المفضّل الكامل** لرؤية source_type=manual.
   - `accounting_periods` (12 صفًا) + `chart_of_accounts` (108) — للتأكد من الفترات.
   - فواتير `OPEN-*`: تُشمل ضمن purchaseInvoices تلقائيًا.
ب) أو **read-only user مؤقت** (`pg_read_all_data`) + قائمة الجداول أعلاه — وأتعامل معه بحذر قراءة فقط، وأعلمه (لا أطبع كلمات مرور في أي مخرجات/سجلات).

## الاستعلامات الجاهزة (أراجعها أنا قبل أن تشغلها)
**AP-1 — صورة عامة للفواتير**
```sql
SELECT "paymentStatus", count(*) n, sum("totalAmount")::numeric(16,2) tot, sum(COALESCE("paidAmount",0))::numeric(16,2) paid
FROM "purchaseInvoices" GROUP BY 1 ORDER BY 1;
```
**AP-2 — الطرف المساعد كما تحسبه العرضية (تحقق من 50,251.51)**
```sql
SELECT COALESCE(sum("totalAmount")-sum(COALESCE("paidAmount",0)),0)::numeric(16,2) AS subledger
FROM "purchaseInvoices" WHERE "paymentStatus" <> 'cancelled' OR "paymentStatus" IS NULL;
```
**AP-3 — الطرف العام (تحقق من 756,343.34)**
```sql
SELECT COALESCE(sum(l.credit-l.debit),0)::numeric(16,2) AS gl
FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
WHERE e.status='posted' AND l.account_code='2000';
```
**AP-4 — من أين يتغذى حساب 2000 تفصيلاً**
```sql
SELECT e.source_type, count(*) n, sum(l.credit-l.debit)::numeric(16,2) net
FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
WHERE e.status='posted' AND l.account_code='2000' GROUP BY 1 ORDER BY 1;
```
**AP-5 — فواتير بلا قيود (أفضل-effort فشل)**
```sql
SELECT count(*) n, sum(i."totalAmount")::numeric(16,2) missing
FROM "purchaseInvoices" i
WHERE NOT EXISTS (SELECT 1 FROM journal_entries e
                  WHERE e.source_type='purchase_invoice' AND e.source_id=i.id::text AND e.status='posted');
```
**AP-6 — دفعات بلا قيود (أفضل انحراف مطابق للإشارة المرصودة)**
```sql
SELECT count(*) n, sum(p.amount)::numeric(16,2) missing
FROM supplier_payments p
WHERE NOT EXISTS (SELECT 1 FROM journal_entries e
                  WHERE e.source_type='supplier_payment' AND e.source_id=p.id::text AND e.status='posted');
```
**AP-7 — قيود يدوية على 2000**
```sql
SELECT e.entry_no, e.date, e.memo, sum(l.credit-l.debit)::numeric(16,2) net
FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
WHERE e.status='posted' AND l.account_code='2000' AND e.source_type='manual'
GROUP BY 1,2,3 ORDER BY 2;
```
**AP-8 — الفواتير الملغاة: هل بقي لها أثر GL؟**
```sql
SELECT count(*) n, sum(i."totalAmount")::numeric(16,2) gross
FROM "purchaseInvoices" i JOIN journal_entries e
  ON e.source_type='purchase_invoice' AND e.source_id=i.id::text AND e.status='posted'
WHERE i."paymentStatus"='cancelled';
```
**AP-9 — الأرصدة الافتتاحية (context)**
```sql
SELECT count(*) n, sum("totalAmount")::numeric(16,2) opening
FROM "purchaseInvoices" WHERE "invoiceNumber" ILIKE 'OPEN-%';
```
**AP-10 — تحليل شهري للوصول للسبب الجذري**
```sql
SELECT to_char(e.date,'YYYY-MM') m, e.source_type, sum(l.credit-l.debit)::numeric(16,2) net
FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
WHERE e.status='posted' AND l.account_code='2000' GROUP BY 1,2 ORDER BY 1,2;
```

## فرضيات العمل مرتبة بالاحتمال (ستُختبر بالاستعلامات)
H1. دفعات موردين لم تُرخّل أصلًا (AP-6 > 0) — **الأرجح** (مطابقة للإشارة: GL أعلى من subledger).
H2. قيود يدوية على 2000 بلا فواتير (AP-7).
H3. فواتير ملغاة بقيت لها قيود (AP-8 > 0) و/أو دفعات حُذفت صلبًا مع بقاء `paidAmount` غير معدّل.
H4. فواتير لم تدخل لكريم أصلًا (فجوات إدخال) — تحليل الشهر أول حدوث (AP-10) يكشف dقدوم الانحراف 2026-10 (يوم التحول 2026-10-01).
H5. خطأ معلوماتي في العرض نفسه (مثلًا دفعات مكررة انعكست بصمت) — AP-6+AP-1 يكفيان للفصل.

## المخرجات التي سأسلّمها بعد التنفيذ
جدول أسباب AP-# → الأثر بالهللة → مصدره → الإجراء المقترح (إدخال ناقص بعد ترحيل تصحيحي معتمد / تعديل عرض المطابقة لتشمل openingBalance مع توثيق / سياسة إدخال) → إعادة حساب المطابقة قبل/بعد.
**لا ترحيل تصحيحي قبل موافقتك على التحليل الكامل.**

## احتياجdumps تاريخية؟
غير ضروري للنطاق الحالي (الدفتر يبدأ 2026-09-30). إن أردنا إثبات "السبب الجذري" للقيد التاريخي أو حفظ أدلة لحوكمة، اطلب **صورة قبل أي ترحيل تصحيحي** — وإلا يكفي 2026-09-01 → اليوم كما هو.
