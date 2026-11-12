# GATE 02 — مخرجات التصميم (ADRs + الجداول + إعدادات V2)

- **التاريخ:** 2026-11-10
- **الحالة:** مكتمل للعرض — بانتظار اعتماد المالك قبل GATE 03
- **لم يُنفَّذ:** أي كود تشغيلي، أي هجرة، أي تعديل API، أي تعديل واجهة،
  أي commit أو نشر.

## 1. ما تم تسليمه

| المخرج | الملف |
|---|---|
| فهرس القرارات + الحالة | [docs/adr/README.md](../adr/README.md) |
| 10 قرارات معمارية | [docs/adr/ADR-001…010](../adr/README.md) |
| مسودة هجرة البنية التحتية (145) | [145_integration_infra.sql.draft](drafts/145_integration_infra.sql.draft) |
| رجوع 145 | [145_integration_infra_down.sql.draft](drafts/145_integration_infra_down.sql.draft) |
| مسودة سلسلة ZATCA (146) | [146_zatca_invoice_chain.sql.draft](drafts/146_zatca_invoice_chain.sql.draft) |
| رجوع 146 | [146_zatca_invoice_chain_down.sql.draft](drafts/146_zatca_invoice_chain_down.sql.draft) |
| تصميم قسم إعدادات V2 | [v2-settings-design.md](v2-settings-design.md) |

### الجداول المصمَّمة

**145 (البنية التحتية):**

| الجدول | الغرض |
|---|---|
| `integration_providers` | سجل المزوّدين + تصنيف VERIFIED/INFERRED/UNVERIFIED/BLOCKED + دليل وتاريخ |
| `integration_credentials` | أسرار مشفّرة `v1:` (AES-256-GCM) بنسخة نشطة واحدة لكل مفتاح |
| `integration_outbox` | صادر معاملاتي بمفتاح idempotency فريد وحقول جوهر مجمّدة |
| `integration_events` | سجل append-only لمحاولات الصادر/الوارد/التغييرات الداخلية |

**146 (ZATCA):**

| الجدول | الغرض |
|---|---|
| `zatca_devices` | أجهزة EGS وبيئتها (`developer_portal/simulation/production`) واعتمادها |
| `zatca_invoice_records` | UUID + ICV + PIH + تجزئة + XML موقّع + ربط الصادر |

### الصلاحيات المقترحة (ADR-005)

`compliance.view` / `compliance.configure` / `compliance.submit` /
`compliance.review`، مع منع الجمع بين الكتابة والإرسال والمراجعة لغير admin،
ومنع self-review. لا أدوار جديدة، ولا منح تلقائي.

## 2. ما لم يُنفَّذ (مقصود)

- `database/migrations/` لم يُلمس؛ لا ملف 145/146 داخلها.
- `backend/permissions.js` و`server.js` و`settings.js` بلا أي تعديل.
- لا مسارات `/api/integration/*` جديدة، ولا تغيير على مسارات ZATCA القائمة.
- لا تشغيل حقيقي لأي جهة، ولا رفع `zatca`/`mudad`/`gosi`/`qiwa` من تصنيفها.
- لا commit ولا دفع ولا نشر.

## 3. التحقق المنفَّذ

| الفحص | النتيجة |
|---|---|
| تنفيذ مسودتَي 145+146 داخل معاملة على `karim_erp_test` ثم `ROLLBACK` | نجح، exit=0 |
| بقاء أي جدول بعد الرجوع | 0 جدول (`information_schema`) — لا أثر دائم |
| وجود `VAULT_KEY` في البيئة | موجود (بلا عرض القيمة) |
| قيم بيئة ZATCA القائمة | `developer_portal` / `simulation` / `production` — طُوبقت في المسودة |
| استقرار الخدمة بعد إعادة التشغيل | 10 دقائق، 40/40 فحصًا، health=200، 0 ERROR/FATAL، 0 acct503، لا 5xx |

## 4. قرارات مطلوبة من المالك

1. **اعتماد ADR-001…010** كمرجع ملزم (أو تحديد ما يُعدَّل منها).
2. **نطاق الهجرة:** اعتماد 145 ككتلة واحدة، و146 منفصلة؟ أم تأجيل 146؟
3. **من يملك `compliance.*` غير admin؟** المقترح: لا أحد تلقائيًا.
4. **المحاسب القانوني** الذي يوقّع ورقة قواعد الزكاة/الدخل (ADR-007).
5. **قناة التنبيهات** المعتمدة (بريد المشروع الحالي أم غيرها) — ADR-010.
6. **الاعتماد على 6 سنوات للاحتفاظ** (INFERRED حاليًا) يحتاج تأكيدًا قانونيًا.
7. **مدد:** هل نُجهّز تقرير أجور محلي مراجَع (بلا إرسال) في GATE 03، أم نؤجل
   كل عمل مدد حتى وثيقة رسمية؟

## 5. نطاق GATE 03 المقترح (لا يبدأ إلا بموافقة)

1. تطبيق 145 على `karim_erp_test` فقط + اختبارات هجرة/رجوع معزولة.
2. إضافة مفاتيح `compliance.*` إلى الكتالوج + مصفوفة SoD + اختباراتها.
3. مسارات `/api/integration/*` للقراءة أولًا (health/providers/outbox/events)،
   بلا إرسال حقيقي.
4. قسم V2 «الامتثال السعودي» بوضع قراءة فقط + لافتة الحقيقة.
5. اختبارات عقد: لا أسرار في الاستجابة، 409 للتفعيل غير المتحقق، 403 للصلاحيات،
   منع self-review.
6. تقرير أدلة ثم توقف للاعتماد. أي تشغيل على الإنتاج يبقى قرارًا منفصلًا.
