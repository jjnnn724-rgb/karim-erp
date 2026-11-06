# 7. FINANCIAL_STATEMENT_MAPPING.md — القوائم المالية والربط الحالي (READ-ONLY)

## 1. ما هو موجود اليوم (بالكود)
| القائمة | الحالة | الموقع / الملاحظات |
|---|---|---|
| ميزان المراجعة TB | ✅ موجود + balanced flag | `accounting-routes.js:523-545` — من الشجرة + القيود مجمعة |
| دفتر العام GL | ✅ عرض قيود (pagination يدوي limit≤200) | `/journal` |
| قائمة المركز المالي BS | ✅ عبر `financial-statements-engine.generateBalanceSheet` | `/balance-sheet` — يمشتق من `type` |
| قائمة الدخل IS | ✅ `generateIncomeStatement` | `/income-statement` |
| تدفق نقدي | ⚠️ مباشر بدائي على 1000/1010 فقط | `accounting-periods.js:229+` |
| التغيرات في حقوق الملكية | ❌ غير موجودة | — |
| نسب مالية | ❌ غير موجودة | — |
| ربحية مركز تكلفة | ✅ `profit-by-cost-center` (من سطور القيد) | `accounting-growth.js` |
| ربحية فرع | ❌ غير موجودة (فروع تُختم على القيد لكن لا تقرير فرع) | — |
| مقارنة فترات/سنوات | ❌ جزئي (من/إلى فقط في TB/IS) | — |
| تتبع التعديلات | ⚠️ `journal_entries status` فقط | لا سجل تعديل للقيد (095 يمنع الهوية فقط) |
| تقارير الاستثناءات | ❌ غير موجودة | — |
| المطابقات AR/AP | ✅ views + endpoint | `view_*_reconciliation` |

## 2. أوجه القصور في الربط الحالي
1. **`currency: 'SAR'` ثابتة في الكود** (`financial-statements-engine.js`) — لا دعم متعدد عملات، ولا حتى عملة الفرع.
2. **لا يوجد جدول mapping**: التصنيف يُشتق من `type` فقط ⇒ لا يمكن لنفس الحساب أن يظهر في بندين مختلفين بقوائم مختلفة (مثلًا: ضريبة مدخلات 1150 كأصول متداولة vs أصل ضريبي؟؛ قرض قصير vs طويل الأجل).
3. **لا فرق بين التصنيف الشجري والتصنيف التقديري لكل قائمة** — المطلوب تصميمًا (قسم في البرومبت §9).
4. **لا إقفال سنة** (لا قيد إغلاق لإيرادات/مصروفات → 3100 آلي؛ `fiscal_years` موجود كجدول لكن غير مربوط بترحيل إقفال).
5. **لا تتبع تعديلات/reversal linkage** (لا `reversal_of_entry_id`).
6. **لا توحيد للقوائم على مستوى المجموعة** (multi-company) — لا كيان شركة في القاعدة أصلًا.
7. **TB لا يفصل افتتاحي/حركة/ختامي** ولا يعرض أرصدة افتتاحية (`010_opening_balances` موجود بجدول `inventory_ledger` فقط — غير محاسبي بالكامل؛ `accounting-periods` فيها opening موجود جزئيًا في `fiscal_years.opening_balances` JSONB — غير مطبق).

## 3. التصميم المستهدف (مرجعي للمرحلة 4)
```
statement_mapping(id, statement_code, section_code, line_code, account_code|subtype mask,
                  side(debit/credit/balance), priority, sign, active, valid_from/to)
statements: BS | IS | CF | SOCE | TB | GL
each account carries fs_classification (default) + statement-specific override rows
engine reads mapping (not type) → deterministic, reviewable, diffable
Cash Flow: direct method on 1000/1010 + adjustment section from CF class on accounts
Equity: opening + NI + distributions − closing (driven by 3xxx movements)
```

## 4. تصنيف الحسابات الحالي → القوائم (الاشتقاق الحالي)
| نوع الشجرة | المعالجة الحالية | الملاحظة |
|---|---|---|
| asset | BS — أصول | لا فصل متداول/غير متداول في العرض إلا بتجميع المجموعات 11/12 (هش) |
| liability | BS — التزامات | نفس الملاحظة |
| equity | BS — حقوق ملكية | لا SoCE |
| revenue | IS — إيراد | بلا خصومات/مردودات مستقلة |
| cogs | IS — تكلفة | معروضة كبند مستقل؟ (يعتمد على engine) |
| expense | IS — مصروف | بلا توزيع تشغيلي/إداري صريح |

## 5. الحكم
القوائم "تعمل" للعرض اليومي، لكنها ليست `IFRS-grade` ولا حتى "مراجعة محاسبية" — لا مصدر واحد نظيف للتصنيف، لا تتبع، لا SOCE/CF حقيقيتين، لا مقارنة. **المرحلة 4 واجب قبل أي ادعاء IFRS.**
