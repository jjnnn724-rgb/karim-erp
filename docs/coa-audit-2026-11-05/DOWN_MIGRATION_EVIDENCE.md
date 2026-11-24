# دليل down للهجرات السبع 134 → 143 (بروفة فعلية كاملة)

- **التاريخ:** 2026-11-07 (توقيت الجهاز UTC+3)
- **القاعدة:** `karim_erp_window_restore` — استعادة جديدة لنسخة الإنتاج المشفّرة
  `karim_erp-nightly-20261106212744.dump.kbak` (ليست الإنتاج `karim_erp`).
- **السكربت:** `scripts/coa-migrations-rehearse-7.js` — يرفض أي قاعدة خارج
  `karim_erp_test` / `karim_erp_staging` / `karim_erp_window_restore`؛ **الإنتاج ممنوع**.
- **الأمر:**

```bash
node scripts/coa-migrations-rehearse-7.js --db karim_erp_window_restore
```

- **النتيجة:** `7 up + 7 down` — كل خطوة تحققت لحظة تنفيذها، والقاعدة عادت
  مطابقة للأساس حرفيًا (users/chart/journal/TB/الأرصدة/البنية)، عدا
  `account_mapping_audit` المحفوظ بالتصميم.

## 1) خط الأساس قبل أي تطبيق (مقيس)

```json
{"mapping":-1,"reports":-1,"rules":-1,"audit":24,"mappingTrig":0,
 "coaMetaCols":0,"coaTriggers":0,"accounts135":0,
 "users":173,"chart":108,"je":37826,"jl":75867,
 "tb":{"dr":"7521326.29","cr":"7521326.29"},
 "balances":{"1150":"100667.93","1200":"-915.77","2100":"0.00",
             "3100":"-2252293.42","4000":"-3666222.74","5000":"722533.01"}}
```

`mapping=-1` يعني الجدول غير موجود (قبل 134). الميزان والأرصدة **posted فقط**
(`e.status='posted'`)، لأن `journal_entries` لا يحمل أعمدة إجماليات.

## 2) التطبيق 134 → 143 (قياس بعد كل خطوة)

| # | Migration | القياس بعد التطبيق | التحقق |
|---|---|---|---|
| 1 | `134_coa_foundation` | mapping=25، metaCols=5، coaTriggers=2 | ✅ |
| 2 | `135_coa_global_sections` | accounts135=16، chart=124، mapping=25 | ✅ |
| 3 | `139_coa_mapping_phase3` | mapping=33 | ✅ |
| 4 | `140_coa_mapping_yarasoft` | mapping=34 | ✅ |
| 5 | `141_coa_mapping_stock_transfer` | mapping=43 | ✅ |
| 6 | `142_account_mapping_guardrails` | rules=13، mappingTrig=2، mapping=43 | ✅ |
| 7 | `143_coa_mapping_read_paths` | mapping=49، reports=6، rules=13 | ✅ |

في كل الخطوات: `users=173`، `je=37826`، `jl=75867`،
`TB dr=cr=7,521,326.29`، وأرصدة الحسابات الستة **لم تتغير** — الهجرات لا تكتب
في `journal_entries`/`journal_lines`.

ملاحظة مقاسة: `audit` ارتفع 24 → 30 عند 143 لأن trigger التدقيق (142) سجّل
الصفوف الستة المُدخلة — سلوك متوقع.

## 3) الرجوع 143 → 134 (قياس بعد كل down)

| # | Migration | القياس بعد الرجوع | التحقق |
|---|---|---|---|
| 1 | `143_..._read_paths_down` | mapping=43، reports=0، rules=13، mappingTrig=2 | ✅ |
| 2 | `142_..._guardrails_down` | rules=-1 (جدول مسقط)، mappingTrig=0، **audit=36 محفوظ** | ✅ |
| 3 | `141_..._stock_transfer_down` | mapping=34 | ✅ |
| 4 | `140_..._yarasoft_down` | mapping=33 | ✅ |
| 5 | `139_..._phase3_down` | mapping=25 | ✅ |
| 6 | `135_global_sections_down` | accounts135=0، chart=108 | ✅ |
| 7 | `134_foundation_down` | mapping=-1، metaCols=0، coaTriggers=0 | ✅ |

بعد الـdown الأخير:

```json
{"mapping":-1,"rules":-1,"audit":36,"mappingTrig":0,
 "coaMetaCols":0,"coaTriggers":0,"accounts135":0,
 "users":173,"chart":108,"je":37826,"jl":75867,
 "tb":{"dr":"7521326.29","cr":"7521326.29"},
 "balances":{"1150":"100667.93","1200":"-915.77","2100":"0.00",
             "3100":"-2252293.42","4000":"-3666222.74","5000":"722533.01"}}
```

**مطابق للأساس** — بما فيه الحسابات والقيود والميزان والأرصدة.

## 4) إصلاح مطلوب كان في ملفات down (وهو مثبت الآن)

`143/141/140/139` تحذف صفوف `account_mapping` لحسابات عليها قيود **posted**
(1000/1010/4000/5000/1200). بعد تطبيق 142، حارس `ACCOUNT_MAPPING_LOCKED` يرفض
الحذف إلا باعتماد صريح. لذلك بدأ كل ملف من الأربعة بـ:

```sql
SET LOCAL coa.allow_mapping_change = 'on';
SET LOCAL coa.mapping_change_reason = 'rollback <رقم> (maintenance window)';
```

أول بروفة فشلت عند 143_down بـ`ACCOUNT_MAPPING_LOCKED` على
`reports.bank_reconciliation.bank_account→1010`؛ بعد الإضافة نجحت السلسلة
كاملة. الاعتماد مقصور على معاملة الرجوع نفسها ولا يفتح بابًا دائمًا.

## 5) خصائص الرجوع (حدود مقصودة)

- `135_down` يحذف الحسابات الـ16 **فقط** إذا لا يوجد عليها سطر قيد
  (`NOT EXISTS journal_lines`) — لا يحذف حسابًا عليه حركة.
- `139/140/141/143_down` يحذف الصفوف **فقط** إذا طابقت القيمة المبذورة؛ تعديل
  إداري لاحق لا يُمحى بالرجوع.
- `142_down` يسقط الحراس والقواعد **ويُبقي `account_mapping_audit`** كأثر رقابي.
- `134_down` **مدمّر بطبيعته** (يسقط جداول الخريطة وقيمها) — في نافذة الإنتاج
  يُستخدم فقط إذا كان 134 قد طُبّق في نفس النافذة، وإلا فالمسار الأخير هو
  استعادة النسخة الاحتياطية.

## 6) إعادة الإنتاج

```bash
# على نسخة مستعادة فقط — السكربت يرفض الإنتاج
node scripts/coa-migrations-rehearse-7.js --db karim_erp_window_restore
```

البروفة لا تحتاج `psql`، ولا تلمس Oracle/YaraSoft، وتنتهي بالقاعدة في حالتها
الأصلية. مخرجات التشغيل الكاملة محفوظة في محادثة الجلسة (2026-11-07).
