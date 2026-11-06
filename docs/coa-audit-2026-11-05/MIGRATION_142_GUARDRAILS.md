# Migration 142 — حراس account_mapping (DDL مختصر + مثال مقيس لكل سلوك)

- **الملفان:** `database/migrations/142_account_mapping_guardrails.sql` و`142_account_mapping_guardrails_down.sql`
- **الإثبات:** `tests/coa-mapping-guardrails.test.js` — **18/18 ✅** (2026-11-07، معاملة واحدة + SAVEPOINTs + ROLLBACK)
- **الطبيعة:** additive بالكامل؛ لا تعديل ولا حذف لأي صف قائم في `account_mapping`.

## DDL مختصر

```sql
-- (1) جدول الأنواع المسموحة — 13 دورًا
CREATE TABLE account_mapping_type_rule (
    role          VARCHAR(40) PRIMARY KEY,
    allowed_types TEXT[]      NOT NULL CHECK (cardinality(allowed_types) > 0),
    note          TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- أمثلة: cash/bank/inventory = {asset}، payable/vat_output = {liability}،
--        revenue = {revenue}، cogs = {cogs}، expense/cost = {expense,cogs}، equity = {equity}

-- فحص مسبق fail-closed: أي صف قائم مخالف يوقف التطبيق كله
DO $$ ... FOR r IN (mapping ⋈ type_rule ⋈ chart WHERE NOT (type = ANY allowed_types))
       RAISE EXCEPTION 'ACCOUNT_MAPPING_TYPE_MISMATCH (قائم)' USING ERRCODE='23514'; ... $$;

-- (2) سجل تدقيق لكل تغيير
CREATE TABLE account_mapping_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module, operation, role,
    action CHECK (action IN ('INSERT','UPDATE','DELETE')),
    old_account_code, new_account_code,
    old_active, new_active,
    old_cost_center_policy, new_cost_center_policy,
    changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    db_user    TEXT NOT NULL DEFAULT current_user,
    reason     TEXT
);

-- (3) حارس BEFORE لكل صف
CREATE TRIGGER trg_account_mapping_guard
    BEFORE INSERT OR UPDATE OR DELETE ON account_mapping
    FOR EACH ROW EXECUTE FUNCTION trg_fn_account_mapping_guard();

-- (4) تدقيق AFTER لكل صف
CREATE TRIGGER trg_account_mapping_audit
    AFTER INSERT OR UPDATE OR DELETE ON account_mapping
    FOR EACH ROW EXECUTE FUNCTION trg_fn_account_mapping_audit();
```

سياسة الموافقة (نفس نمط 134، جلسة فقط):

```sql
SET LOCAL coa.allow_mapping_change = 'on';          -- تجاوز قفل الحساب المرحّل
SET LOCAL coa.mapping_change_reason = 'سبب التغيير'; -- يُكتب في التدقيق
```

## مثال 1 — مطابقة النوع (fail-closed)

```sql
-- payable يجب أن يكون التزامًا؛ 4000 إيراد
INSERT INTO account_mapping (module, operation, role, account_code)
VALUES ('sales_pos', 'pos_sale', 'payable_account', '4000');
```

**المقيس:** رفض `23514 ACCOUNT_MAPPING_TYPE_MISMATCH`، **صفر صف** في
`account_mapping` و**صفر أثر** في `account_mapping_audit` (الحارس يسبق التدقيق).

```sql
-- إدراج صحيح لدور مسموح يُقبل ويُدقَّق
INSERT INTO account_mapping (module, operation, role, account_code, updated_by)
VALUES ('zz_guard','report','revenue_account','4000',1);
```

**المقيس:** قُبل، وسُجّل صف تدقيق `action=INSERT` (`old=null → new=4000`,
`changed_by=1`).
**الاستثناء المقصود:** الدور غير المذكور في `type_rule` مسموح (open-world)
ويُسجّل في التدقيق فقط — إضافة دور جديد = صف واحد بعد مراجعة محاسبية.

## مثال 2 — التدقيق (كل تغيير، حتى لو لم يتغير الحساب)

```sql
UPDATE account_mapping SET active = FALSE, updated_by = 1
 WHERE module='sales_pos' AND operation='pos_sale' AND role='revenue_account';
```

**المقيس:** صف `action=UPDATE` يحمل `old_account_code = new_account_code`
و`old_active = true → new_active = false`، مع `changed_by = 1`، و`db_user`
الحقيقي، و`reason` من `coa.mapping_change_reason` إن ضُبط.

## مثال 3 — قفل الحساب الذي عليه قيود مرحّلة

```sql
-- الحساب 1000 عليه قيود posted
UPDATE account_mapping SET account_code = '1010'
 WHERE module='sales_pos' AND operation='pos_sale' AND role='cash_account';
```

**المقيس:** رفض `ACCOUNT_MAPPING_LOCKED`.

```sql
BEGIN;
SET LOCAL coa.allow_mapping_change = 'on';
SET LOCAL coa.mapping_change_reason = 'اعتماد المدير المالي 2026-11-07';
UPDATE account_mapping SET account_code = '1010' WHERE ...;
COMMIT;
```

**المقيس:** قُبل، وسُجّل UPDATE من `1000 → 1010` مع السبب ومن غيّر.

- **حذف** ربط على حساب مرحّل (`cogs 5000`) يُرفض بلا موافقة، وبموافقة
  صريحة يُقبل ويُسجَّل `DELETE`.
- **الحساب غير المرحّل** (`assets.depreciation_run.accumulated_account`،
  تعديله 1000 → 1010) يُعدَّل بلا موافقة — القفل على المرحّل فقط. وحذف صف
  `expense_account` المرتبط بـ6600 (بلا قيود مرحّلة) مسموح ويُسجَّل `DELETE`.

## إعادة التطبيق والرجوع

- إعادة تطبيق 142: `rules=13`, `triggers=2`, **صفر** صف تدقيق جديد (idempotent).
- `142_down`: يسقط الحارس والتدقيق و`type_rule`، و**يُبقي
  `account_mapping_audit`** كأثر رقابي (قرار موثّق في رأس ملف down).
- `ROLLBACK` بعد الاختبار: الحالة مطابقة حرفيًا لما قبل التطبيق
  (`rules=0`, `audit=0`, `triggers=0`, `mapping=25`).

## إعادة الإنتاج

```bash
DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test KARIM_TEST_DB_ISOLATED=1 \
node node_modules/jest/bin/jest.js tests/coa-mapping-guardrails.test.js \
--runInBand --forceExit
```
