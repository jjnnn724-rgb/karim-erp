# FINAL_AUDIT — ترحيل واجهة Karim ERP إلى Native ESM

**التاريخ:** 2026-09-27 · **الفرع:** refactor/esm-migration · **27 استخراجًا ذريًا · صفر انقطاع للسيرفر**

## 1-2. الخريطة قبل/بعد
- app.js: **12,353 → ~595 سطرًا** (خفض ~95%) — بقية: مؤشرات + IIFE الدخول + boot + غراء التحسينات
- 27 موديول ESM جديدًا في core/ و ui/ و features/ — كل نقل **verbatim مُتحقق بايتيًا أو بـ acorn**

| core/ | ui/ | features/ |
|---|---|---|
| config, state, api, i18n, utils, storage, pwa | toast, enhancement | auth-navigation, page-router, employees, departments, warehouse, kitchen, finance, hr, reports, settings-users, cfo, dashboard, employee-portal, smart-card, bulk-import, yarasoft, whatsapp, zkteco |

## 3. رسم الاستيراد
main.js (module entry, TLA) → core modules (static) → features (dynamic, بعد الجسور) → app.js (classic defer) → scanner/realtime

## 4. الجلوبالات: 259 تعيينًا + 415 دالة auto-global + 5 عقد realtime + 12 معالج index.html — كلها مغطاة بجسور BRIDGE-001..027 (انظر DEPRECATION_LOG.md)
## 5. DOM: 451 معرفًا + 417 اسم inline — محفوظة حرفيًا
## 6. API: 188 endpoint — الحقوق والأساليب والحِمَل دون تغيير (api-inventory.json)
## 7. التخزين: karim_lang فقط (runtime) — دون تغيير
## 8. الأحداث: 50 مستمعًا + 18 حدث socket — دون تغيير
## 9. ترتيب الإقلاع: محفوظ (dynamic-import + TLA يحفظ ترتيب defer)
## 10. الجسور: نشطة — خطة إزالة موثقة
## 11-12. الانحدارات المتبقية: اختبار UI شامل يدوي لكل صفحة (تُرسم كلها) · الدين الفني: فصل عناقيد مختلطة (smart-card يحوي تقارير الحضور)
## 13. ملفات محذوفة: لا شيء (pos.js/bilingual.js/pos-orders.js ميتة — بانتظار قرار المالك)
## 14. المقاييس: 27 extraction · 27 BRIDGE · app.js −95%
## 15. التحقق: فحوص الدخان الحي بعد كل استخراج + دورة خروج/دخول + 12 صفحة تنقل ✓
## 16. النشر: كل commit يرفع ?v= + CACHE_VERSION معًا (قاعدة إلزامية) · مزامنة نسخة Capacitor مطلوبة عند أول توزيع
