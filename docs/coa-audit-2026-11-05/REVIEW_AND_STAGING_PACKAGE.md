# 14. REVIEW_AND_STAGING_PACKAGE.md — حزمة مراجعة SQL الخارجية + تسلسل الـ Staging

## الملفات الخمسة (على جهازك — انسخها للمراجع الخارجي كما هي)
الأساس: `C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\database\migrations\`

| الملف | الأسطر | SHA256 |
|---|---|---|
| `134_coa_foundation.sql` | 209 | `d14172de77facae1130f126cd8ed0754fd380ed324b78f20f8c819982674224c` |
| `134_coa_foundation_down.sql` | 37 | `217466771a8fba3fdd599db42ca2b60c066f52acf960ff0285ea663942bc4325` |
| `135_coa_global_sections.sql` | 51 | `9571147a57bd590b576a055a26d591381793add66fc304673b8a4c5aaffe885d` |
| `135_coa_global_sections_down.sql` | 10 | `7fed83f0c71ad66fbc79f33fe5f2b741e5c4e7019deb136ac11d766f753a4ff8` |
| `136_coa_journal_void_only.sql` | 36 | `8c60be0e25ae345cb46f6b1ed24a286de26c7db81c8ca67a2e37846ea4150a95` (**موقوف — لا يُطبَّق**) |

التحقق من سلامة النسخ عند المراجع: أعد حساب SHA256 وإلا ارفض النسخة. الفحص الساكن (توازن الأقواس مع تجاهل التعليقات والنصوص) **اجتازته الخمسة**. **الفحص الساكن ليس بديلًا عن تشغيل SQL على قاعدة معزولة** — هو ترياق أخير فقط.

## ما يجب أن يثبته المراجع (Checklist للمراجعة الخارجية)
1. 134: الأعمدة كلها nullable/بـ default ⇒ لا تكسر INSERT قديم ولا تشكل إعادة كتابة للجدول بمعنى `Access Exclusive` خطرة على جدول 35 ألف قيد؟ (لا تُضاف أعمدة لـ journal_entries بل chart_of_accounts الصغيرة — آمنة).
2. الـ backfill `normal_balance` من type في نفس المعاملة، ثم `ADD CONSTRAINT ... NOT VALID` ثم `VALIDATE CONSTRAINT` — ترتيب سليم.
3. `trg_fn_coa_no_cycle`: أثناء INSERT لأول مرة — `SELECT parent_code INTO v_current` لأب موجود عبر FK — سليم؛ يمنع A→B→A. (مراجعة: هل يغطي UPDATE لـ parent_code على أي عمق؟ نعم عبر مشي تصاعدي.)
4. `trg_fn_coa_lock_posted_semantics`: يمنع تغيير type/normal_balance فقط إن وُجدت حركة posted **وزمن** `coa.allow_type_change<>'on'` — يفضّل المراجع تأكيد أن لا كود داخلي يعتمد UPDATE type على حسابات ذات حركة.
5. `account_fs_mapping`: الفهارس الجزئية الفريدة بدل UNIQUE على valid_from NULL — التفرّد صحيح الآن.
6. `account_mapping`: FK على chart_of_accounts(code) · ON CONFLICT DO NOTHING للبذرة · لا تغيير سلوك (الكود القديم لم يُربط بها بعد).
7. `135`: معرفات 9002+ لا تصطدم (حتى 8004 موجودة اليوم) · الجذران 71/72 متسقّا النوع (revenue/expense) · 8000 كلها `is_postable=false` و`is_suspense`.
8. `134_down`/`135_down`: يسقطان الجديد فقط ولا يمسّون حسابًا له حركة (شرط `NOT EXISTS journal_lines` في 135_down).
9. تأكيد: لا DDL يمس `journal_entries/journal_lines` في 134/135 (فقط trigger لا-DELETE في 136 الموقوف).
10. تأكيد Oracle: لا شيء.

## تسلسل التطبيق (عند موافقة المراجع الحرفي + موافقتك)
```powershell
# 1) نسخة احتياطية كاملة مؤكدة + اختبار استرجاع فعلي على قاعدة منفصلة (ليس على الإنتاج):
#    استخدم scripts/backup ثم استرجع على karim_erp_restore_test وتحقق:
#    SELECT count(*) FROM journal_entries;  -- يجب 35,278
#    SELECT count(*) FROM chart_of_accounts; -- يجب 108
# 2) بوابة staging (قاعدة staging منفصلة، نفس إصدار PostgreSQL 18.6):
$env:DB_NAME='karim_erp_staging'; node database/scripts/run-migration.js database/migrations/134_coa_foundation.sql
#    فحص: SELECT count(*) FROM account_mapping;  -- 25
#    فحص: SELECT normal_balance, count(*) FROM chart_of_accounts GROUP BY 1;  -- debit|credit فقط
#    فحص: SELECT count(*) FROM chart_of_accounts WHERE normal_balance IS NULL; -- 0
#    تشغيل التطبيق على staging + بيع تجريبي (smoke) — يُرحل قيدًا متوازنًا
$env:DB_NAME='karim_erp_staging'; node database/scripts/run-migration.js database/migrations/135_coa_global_sections.sql
#    فحص: SELECT code, is_postable, is_suspense FROM chart_of_accounts WHERE code IN ('71','72','7101','7104','7205','8','8101','8102','8103') ORDER BY code;
#    المطلوب: 7101-7205 postable=true و8101-8103 postable=false وكل 8000 is_suspense=true
# 3) رجوع تجريبي على staging فقط: down 135 ثم up 135 ثم down 134 ثم up 134 — ثم فحص مجددًا
# 4) تقرير staging كامل يُسلّم للمالك قبل أي إنتاج. الإنتاج: نافذة صيانة + نسخة احتياطية + 134 ثم 135 — بأمر حرفي منك.
```
**لا أحد ينفّذ شيئًا من هذه الخطوات دون إذنك الحرفي. 136 لا تُطبَّق ولا في أي مرحلة قبل إتمام التحويل في PURGE_CONVERSION_PLAN.md.**
