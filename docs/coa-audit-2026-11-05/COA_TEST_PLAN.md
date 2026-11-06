# 11. COA_TEST_PLAN.md — خطة الاختبار (لم تُنفذ بعد — للموافقة عليها أولًا)

## طبقات الاختبار
1. **Unit** (Jest) — postJournal, bridgeKey/fingerprint, normalizeCostCenterCode, mapping engine.
2. **DB Integration** — على `karim_erp_test` (القاعدة محمية: NODE_ENV=test + DB_NAME≠karim_erp_test ⇒ رفض الاتصال).
3. **Scenario/Contract** — نفس القيد قبل/بعد أي تغيير integration.
4. **Staging E2E** — نسخ staging معطلة عن Oracle.
5. **UI** — RTL/LTR + آلاف الحسابات (perf budget: عرض الشجرة < 300ms تحميل أولي افتراضي).
6. **Security/RBAC** — كل صلاحية `permission` تُختبر allow/deny.

## مصفوفة الاختبارات المطلوبة (البرومبت §16)
### Chart of Accounts
- إنشاء حساب رئيسي / فرعي (parent_code صالح + تطابق النوع). · منع كود مكرر (409). · منع أب = الابن. · منع دورة A→B→A (trigger الجديد). · منع ترحيل على تجميعي (`is_postable=false` ⇒ 422). · منع ترحيل غير نشط (`is_active=false` ⇒ 422). · منع حذف حساب له حركات (سياسة void/deactivate فقط). · نقل حساب مع دفع حركات تاريخيًا (قبل/بعد TB متطابق). · سلامة مستويات الشجرة (اتساق root/group/posting مع code mask).

### General Ledger
- توازن: Σمدين = Σدائن عند posted (قاعدة + تطبيق). · القيد اليدوي غير المتوازن ⇒ 422 قبل الإدراج. · قيد بسطر واحد ⇒ 422. · كلا الجانبين في سطر ⇒ 422. · source_type/id idempotent (نفس external_ref مرتين ⇒ نفس القيد، `replay=true`). · duplicate manual fingerprint ≤10 دقيقة ⇒ replay. · reversal/void: `POST /journal/:id/void` ⇒ قيد معكوس موقّع، TB قبل/بعد بالفارق المتوقع فقط. · قفل فترة: ترحيل إلى 2026-01 (إن أُقفلت) ⇒ 423. · إعادة المحاولة بعد فشل (simulated 23505 ×3) ⇒ نجاح/رجوع آمن. · قسم مقفول بين الفحص والإدراج (R-07) ⇒ مرفوض داخل المعاملة.

### Financial Statements
- TB: ≥0 حسابات، balanced=true، إجمالي = Σ القيود posted فقط. · BS: أصول = التزامات + حقوق ملكية (مع فجوة فتح موثقة إن وُجدت). · IS: إيراد − تكلفة − مصروف = صافي (يطابق فرق 3100). · CF (مباشر): Σ Δ1000/1010 = نقدية أول الفترة − آخرها (بفرق التسويات موثق). · SOCE: حقوق ملكية أول + صافي + مسحوبات = آخر. · مقارنة فترات (شهر/سنة) — الأرقام تتغير فقط حسب القيود. · القوائم = من الـ mapping (Phase 4) — أي تعديل mapping يظهر في التقرير التالي فورًا.

### Integration
- **Oracle معطلة تمامًا** (staging): إقلاع ✅ · بيع محلي يُرحّل ✅ · TB/BS/IS ✅ · AR/AP ✅ · (يُسجَّل 0 اسنعلام خارجي). · **Oracle بطيئة/متقطعة**: circuit breaker يفتح بعد 3 إخفاقات · الشاشات تعرض stale+لاكتيمة · الدفتر لا يتأثر. · **تكرار استيراد نفس الفاتورة**: `revenues.external_ref` UNIQUE ⇒ صف واحد؛ جسر GL ⇒ قيد واحد (replay). · **فشل المزامنة + إعادة تشغيل**: sweep `bridgeUnbridged` يلحق الباقي. · **تعارض (نفس external_ref بمبلغ مختلف)**: يُسجَّل في `yarasoft_review_items` لا يُرحّل (رصدي).

### Security / RBAC
- `admin` يفعل كل شيء · `accountant` يكتب/يعرض ولا يعيد فتح فترة ولا يدير الصلاحيات · `manager/auditor` عرض فقط · `cashier` لا يصل `/api/accounting` · دور غير معروف ⇒ 403 على كل مسار محاسبي · فصل المهام: كاتب القيد ≠ معتمد المسودة لنفس القيد (سياسة) · `created_by` إلزامي للقيود البشرية · هوية نظام (`system:ara-…`) للآلية + سجل outbox.

### UI
- RTL كامل للعربية · LTR للإنجليزية · RTL↔LTR تبديل لغة حي · بحث فوري بالكود/الاسمين · تصفية (type/postable/active/usage) · لوحة مفاتيح (↑↓ Enter Arrows) · 1000 حساب ⇒ تفاعل <100ms (virtualization) · طباعة شجرة · تصدير CSV/PDF · لا كسر لشاشات حالية (smoke E2E).

### أداء/موثوقية
- 50 ألف قيد متوازي (pgbench بسيط) ⇒ لا deadlock · trigger التوازن يحترم ±0.01 · لا قيد `posted` بلا سطرين · لا `source_id` مكرر.

## بوابة النجاح
100% من P0 (توازن · عدم ازدواج · قفل فترة · فصل صلاحيات · Oracle-offline) تخضر على staging قبل Phase 7.
