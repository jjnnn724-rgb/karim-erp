# 16. PURGE_CONVERSION_PLAN.md — خطة تحويل الحذف الصلب إلى void/عكس (3 مراحل) — 136 تبقى موقوفة

## 1) مواقع الحذف الصلب المؤكدة في الكود (2026-11-05)
| # | الملف | الأسطر | ما يُحذف | البادئة الدومين | الترول (دور) |
|---|---|---|---|---|---|
| P1 | `backend/procurement-routes.js` | 849, 868-869 | `supplier_payments` + `journal_entries/lines` بـ `source_type='supplier_payment'` | عكس دفعة مورد | حسب مسار "void" للدفعة |
| P2 | `backend/server.js` | 1142-1143 | `journal_entries/lines` بـ `source_type='expense'` | حذف مصروف | كود حذف المصاريف |
| P3 | `backend/server.js` | 2657 | `journal_entries` بـ `source_type='dispatch'` (مع RETURNING id ثم غالبًا lines) | عكس/حذف صرف | كود الصرف |
| P4 | `backend/warehouse/purchase-void-routes.js` | 182, 184-189 | دفعات آلية تُعكس مع الفاتورة الملغاة + قيودها | إلغاء فاتورة شراء | `admin` |
| P5 | `backend/warehouse/purchase-void-routes.js` | (لاحقًا) | قيد شراء `source_type='purchase_invoice'` يُحذف مع الإلغاء — يُفحص أثناء المرحلة A | إلغاء فاتورة شراء | `admin` |

النمط المعماري المشترك: الحذف يحدث **داخل معاملة الدومين نفسها** (جيد ذرّيًا)، لكنه يكسر "السجل غير قابل للمحو": بعد الحذف لا يوجد أثر في `journal_entries`؛ الدفعة تُمحى من `supplier_payments` و`paidAmount` قد يبقى غير معدّل (P1) ⇒ انحراف AP المرصود عمليًا ذو علاقة بهذا النمط عبر تراكم الإلغاءات/الحذف.

## 2) التقارير/الـ APIs التي تقرأ من هذه المسارات (للتقييم قبل أي تغيير)
- `/api/procurement/*` — الدفعات، AP aging، أرصدة الموردين، `supplierDueTotal` (يقرأ `supplier_payments` + `openingBalance` + فواتير Unpaid).
- `/api/warehouse/purchase-invoices/:id/void` — منطق VOID (الدور admin).
- `finance-routes` / `finance:reconcile` و"expense register" — قراءة `journal_entries` بمصدر expense (تختفي عند الحذف الصلب — لا خطأ بل **فقدان صامت للأثر**).
- `dispatch` routes — قراءة حالات الصرف (DISTINCT ما تم حذفه نهائيًا — لا يرى شيئًا بعد الحذف).
- `supplier_payments` تُقرأ أيضًا في: whatsapp answer (سؤال "كم دفعنا للمورد")، warehouse reports.
- `audit/` وسجل التدقيق `pos_audit_chain` لا يغطي هذه الجداول — **فجوة حوكمة موثقة**.

## 3) تقارير الاستخدام آخر 6 أشهر (تشغّلها أنت أو أجهّزها بعد وصول Dump/مستخدم قراءة)
```sql
-- عدد الحذفات الفعلية (تقريبي من الفجوات: ids مفقودة / أو من سجلات الطلب في audit إن وُجدت)
SELECT 'supplier_payment' src, count(*) FROM journal_entries WHERE source_type='supplier_payment' AND date >= current_date - interval '6 months';
SELECT 'expense' src, count(*) FROM journal_entries WHERE source_type='expense' AND date >= current_date - interval '6 months';
SELECT 'dispatch' src, count(*) FROM journal_entries WHERE source_type='dispatch' AND date >= current_date - interval '6 months';
-- وعدد الفواتير/الدفعات/المصاريف الحالية بنفس البادئات:
SELECT count(*) FROM supplier_payments WHERE "date"::date >= current_date - interval '6 months';
SELECT count(*) FROM "purchaseInvoices" WHERE "paymentStatus"='cancelled' AND "createdAt"::date >= current_date - interval '6 months';
```
+ سجل requests الحذف/void من access logs (إن وُجدت) — يُثبت معدل الاستخدام الفعلي لمسارات الحذف (إن كان صفرًا، التحويل سهل جدًا).

## 4) خطة التحويل على 3 مراحل (بدون كسر أي مستهلك)
**المرحلة A — المراقبة أولًا (أسبوعان)**
- إضافة `logger.warn('[HARD_DELETE]', {source_type, source_id, user_id, route})` حول كل حذف (P1..P5) — لا سلوك يتغير.
- إضافة عدّاد `app_state` أو جدول `hard_delete_log` (اختياري) لتجميع القياس.
- توثيق: من يستخدم الحذف وفي أي تدفق (تلقائي أم يدوي).

**المرحلة B — الاستبدال بالعكس (مرحلة التنفيذ — بعد الموافقة)**
لكل تدفق (P1..P5) على حدة — PR مستقل بنمط "نفس النتيجة على التقارير + أثر أكبر":
- P1 (عكس دفعة): ممنوع `DELETE` — بدلها: **قيد عكسي** `Dr 1000/Cr 2000` بمفتاح `supplier_payment_void:{paymentId}` (idempotent) + صف في `supplier_payments.status='voided'` (ADD COLUMN status إن لزم — Additive) + `paidAmount` للفاتورة يُنقص تلقائيًا (إعادة حساب من الدفعات النشطة). التقارير (due, paid) تتغير فقط للأدق — لا كسر لأي API (مفاتيح الاستجابة كما هي).
- P2 (expense): عكس `Dr expense / Cr cash` أو void للقيد الأصلي عبر مسار الإلغاء الموجود للقيد (لا DELETE) + وسم المصروف ملغى.
- P3 (dispatch): عكس قيد الصرف عبر source `dispatch_reversal:{dispatchId}` — لا DELETE.
- P4/P5 (إلغاء فاتورة): عكس قيد الشراء الأصلي (`Dr 2000 / Cr 1200/1150`) بدل حذفه؛ نفس نمط `purchase_invoice:void:{id}`. حذف الدفعات الآلية كذلك يُستبدل بvoid صفها + قيد عكسي (كما P1).
- كل PR: Contract test "انبعاث نفس السطور في `journal_lines` قبل/بعد لعملية محاكاة" + اختبار رجوع (void) idempotent.
- تحديث المستهلكين إن لزم: أي كود يعتمد على "القيد اختفى" يُحوّل للتحقق من `status='void'` (واضح في الكود الحالي أنه يعتمد على الحذف — P1/P2).

**المرحلة C — تفعيل 136 + الحوكمة**
- بعد 30 يومًا من صفر حذف صلب في السجلات: تطبيق `136_coa_journal_void_only.sql` على staging، ثم مراقبة أسبوعين، ثم الإنتاج (بموافقتك).
- رجوع 136: `DROP TRIGGER trg_journal_no_hard_delete` (لا يكسر شيئًا — الحذف كان موقوفًا أصلًا).

## 5) معايير "136 جاهزة للتفعيل" (كلها، لا بعضها)
1. صفر عمليات حذف صلب في آخر 30 يوم (من hard_delete_log).
2. كل PR في المرحلة B مدموج + ساعات تشغيل مستقرة ≥14 يومًا على الإنتاج بلا استرجاعات.
3. `view_ap_reconciliation`/AR/تقارير المصاريف والصرف مطابقة قبل/بعد التحويل على عينات حية.
4. نسخة احتياطية مؤكدة + نافذة صيانة + موافقة حرفية.
5. 136 على staging أولًا + أسبوع بلا 532/500 مرتبط بحذف.

## 6) ما لن أفعله قبل التحويل
لن أُفعّل 136، ولن أحذف أي دالة حذف، ولن أغيّر API لهذا الشأن — **كل الاستبدال additive داخل المسارات نفسها**.
