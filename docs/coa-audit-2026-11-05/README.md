# COA Audit 2026-11-05 — فهرس تقارير المرحلة صفر (READ-ONLY)

| # | الملف | المحتوى |
|---|---|---|
| 1 | COA_CURRENT_STATE.md | الحالة الحالية: ما يعمل وما هو مفقود (أرقام حية) |
| 2 | COA_HIERARCHY_AUDIT.md | تدقيق الشجرة: البنية، الأكواد، نقاط الضعف البنيوية |
| 3 | ACCOUNTING_ARCHITECTURE_AUDIT.md | المعماري المحاسبي: postJournal، الجسر، الفترات، الضمانات |
| 4 | POSTGRESQL_DATA_OWNERSHIP.md | ملكية PostgreSQL + حدود العمل بلا Oracle |
| 5 | YARASOFT_ORACLE_DEPENDENCY_MAP.md | خريطة كل اعتماد على YaraSoft/Oracle (قراءة فقط) |
| 6 | ACCOUNT_MAPPING_AUDIT.md | الربط الفعلي الوحدة↔الحساب (الثوابت المتناثرة) |
| 7 | FINANCIAL_STATEMENT_MAPPING.md | القوائم المالية اليوم + تصميم الـ Mapping المستهدف |
| 8 | ACCOUNTING_RISK_REGISTER.md | سجل مخاطر R-01…R-17 بالأولويات |
| 9 | GLOBAL_COA_TARGET_DESIGN.md | التصميم العالمي المستهدف (8 أقسام، Additive) |
| 10 | COA_MIGRATION_PLAN.md | خطة الانتقال المرحلية + خطة الرجوع + حماية التاريخ |
| 11 | COA_TEST_PLAN.md | مصفوفة الاختبارات الكاملة (للموافقة قبل التنفيذ) |
| 12 | EXECUTIVE_SUMMARY.md | للقرار: ما المطلوب منك في Phase 1 |
| 13 | PHASE2_FOUNDATION.md | الأساس المنفّذ + نتائج staging + Rollback + اختبارات Triggers |
| 14 | REVIEW_AND_STAGING_PACKAGE.md | ملفات المراجعة + SHA256 + checklist للمراجع الخارجي + تسلسل staging |
| 15 | AP_VARIANCE_INVESTIGATION.md | حزمة تحقيق انحراف AP — جداول/استعلامات AP-1..AP-10 (لم تُنفذ بعد الوصول) |
| 19 | AP_VARIANCE_FINDINGS.md | **تحليل AP النهائي** — السبب الجذري مثبت رقميًا (259 دفعة = 698,735.91 بلا قيد — 98.9% من الانحراف) — **النطاق: كان شيفت سليمًا — Yara لا يُسجل A/P هنا** |
| 20 | HARD_DELETE_FULL_MAP.md | **القائمة الكاملة لمواقع الحذف الصلب (14 موقعًا) + فجوة حماية المسار العام** |
| - | STATUS.md | **ملخص ما تم وما تبقى** |

الهجرات الجاهزة غير مطبقة بعد: `134_coa_foundation` · `135_coa_global_sections` · `136_coa_journal_void_only` (اختياري). قرارات Phase 1 معتمدة بالتوصية — أي بند قابل للعكس قبل التطبيق على الإنتاج.

## حزمة التسليم الجارية (2026-11-05 — للقرار)
| # | الملف | المحتوى |
|---|---|---|
| 14 | REVIEW_AND_STAGING_PACKAGE.md | ملفات المراجعة + SHA256 + checklist للمراجع الخارجي + تسلسل staging |
| 15 | AP_VARIANCE_INVESTIGATION.md | حزمة تحقيق انحراف AP — جداول/استعلامات AP-1..AP-10 (لم تُنفذ) |
| 16 | PURGE_CONVERSION_PLAN.md | مواقع الحذف الصلب + خطة التحويل 3 مراحل (+ مراقبة/rollback) + معايير تفعيل 136 |
| 17 | API_CONTRACT_NOTE.md | عقد الـ API لـ frontend-v3 — Phase 2 Additive لا يغيّر أي شكل استجابة |
| 18 | TEST_DB_PROVISIONING.md | تزويد `karim_erp_test` المعزولة (لا تُنشأ على الإنتاج) |
| 19 | AP_VARIANCE_FINDINGS.md | **تحليل AP النهائي** — السبب الجذري مثبت رقميًا (259 دفعة = 698,735.91 بلا قيد — 98.9% من الانحراف) |
| 20 | HARD_DELETE_FULL_MAP.md | **القائمة الكاملة لمواقع الحذف الصلب (14 موقعًا) + فجوة حماية المسار العام** |
| - | STATUS.md | **ملخص ما تم وما تبقى** |

الهجرات الجاهزة مطبقة على `karim_erp_staging` و`karim_erp_test` (Rollback مثبت · idempotency مثبتة · ما حدث: chart 124 = 108 + 16 غير رصيدية · الميزان محلي Dr = Cr) — **الإنتاج `karim_erp` لم يُلمس**. `136` موقوفة وأمرك واضح (لم تُطبَّقها). قرارات Phase 1 معتمدة بالتوصية — أي بند قابل للعكس قبل التطبيق على الإنتاج.
