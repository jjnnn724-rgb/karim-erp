# سجل القرارات المعمارية — برنامج الامتثال السعودي

كل القرارات هنا بحالة **مقترح (Proposed)** ولم تُعتمد بعد. لا يُكتب كود تنفيذي
ولا تُطبَّق هجرة قبل اعتماد المالك للأدوار واحدًا واحدًا أو جملةً واحدة.

| ADR | العنوان | الحالة |
|---|---|---|
| [ADR-001](ADR-001-provider-verification-boundaries.md) | حدود المزوّدين وتصنيف الأدلة | مقترح |
| [ADR-002](ADR-002-transactional-outbox.md) | صندوق الصادر المعاملاتي كممر وحيد | مقترح |
| [ADR-003](ADR-003-idempotency-and-retries.md) | مفاتيح عدم التكرار وسياسة الإعادة | مقترح |
| [ADR-004](ADR-004-credential-vaulting.md) | حفظ أسرار التكامل مشفّرة | مقترح |
| [ADR-005](ADR-005-separation-of-duties.md) | فصل المهام وصلاحيات الامتثال | مقترح |
| [ADR-006](ADR-006-zatca-invoice-chain.md) | دورة فاتورة ZATCA وسلسلة التجزئة | مقترح |
| [ADR-007](ADR-007-zakat-income-tax-reports.md) | تقارير الزكاة والدخل (قراءة فقط) | مقترح |
| [ADR-008](ADR-008-mudad-wps-blocked.md) | مدد — الحالة BLOCKED وخطة البديل | مقترح |
| [ADR-009](ADR-009-surfaces-v2-v3.md) | أسطح العرض: إعدادات V2 ثم V3 | مقترح |
| [ADR-010](ADR-010-observability-and-incident-response.md) | المراقبة والتدقيق والاستجابة للحوادث | مقترح |

مراجع مصاحبة:

- [تقييم GATE 01](../phase-0/assessment.md)
- [مسودة هجرة 145 — البنية التحتية](../phase-0/drafts/145_integration_infra.sql.draft)
- [مسودة هجرة 146 — سلسلة ZATCA](../phase-0/drafts/146_zatca_invoice_chain.sql.draft)
- [تصميم قسم «الامتثال السعودي» في إعدادات V2](../phase-0/v2-settings-design.md)
- [ملخص مخرجات GATE 02](../phase-0/gate-02-deliverables.md)
