# SaaS SLO & Runbook — Karim ERP

**الحالة:** `مراقبة مُعدّة كودياً — التنبيه الخارجي غير موصول بعد`
**التاريخ:** 2026-11-24
**السياق:** `docs/SAAS-GLOBAL-TRANSFORMATION-PLAN.md` · `backend/saas/saas-metrics.js`

---

## 1) مصدر القياس

`/api/metrics` (admin/manager) يُعيد الآن حقل `saas` بجانب المقاييس القديمة:

```json
"saas": {
  "totals": {
    "tenant_required": 0, "tenant_mismatch": 0, "resolver_unavailable": 0,
    "signup_attempt": 0, "signup_ok": 0, "signup_rate_limited": 0,
    "quota_denied": 0, "quota_allowed": 0
  },
  "trackedTenants": 0, "otherTenants": 0, "top": [], "at": "..."
}
```

العدّادات في الذاكرة، bounded بـ200 مستأجر (`otherTenants` يستوعب الباقي) — لا يرفع cardinality ولا يلمس المسار الحار.

## 2) الأهداف المقترحة (تُعاير على staging قبل الاعتماد)

| البند | المؤشر | الهدف | الإجراء عند الكسر |
|---|---|---|---|
| توفر حل المستأجر | `resolver_unavailable` | 0 في 5 دقائق | فحص DB/الـresolver؛ التطبيق يفشل مغلقاً (503) — لا يمرر سياقاً خاطئاً |
| محاولات تزوير المستأجر | `tenant_mismatch` | < 0.1% من الطلبات | مراجعة التوكنات/النطاقات؛ `"TENANT_REQUIRED"` و`"TENANT_MISMATCH"` في السجلات |
| إساءة التسجيل | `signup_rate_limited` | < 5% من `signup_attempt` | رفع الحد أو تحويله إلى Redis (الحالي محلي ويتصفر بإعادة التشغيل) |
| رفض الحدود | `quota_denied` / `quota_allowed` | يُراقب كاتجاه لا كخطأ | ارتفاعه = طلب ترقية خطة أو خلل في عدّاد الاستخدام |
| تأخير الطلب | `requests.latency.last1m.p95` | < 300ms (Existing SLO) | `docs/SLO.md` |
| أخطاء الخادم | `requests.server5xx` | < 0.5% | `docs/SLO.md` |

## 3) Runbook مختصر

1. **`resolver_unavailable > 0`** → تأكد أن جدول `tenants`/`tenant_domains` موجود، وأن `DB_*` صحيحة، ثم راجع سجل `[tenant-resolver]`. الخدمة مصممة fail-closed: 503 أفضل من تسريب بيانات.
2. **`tenant_mismatch` مفاجئ** → تحقق من تغيير subdomain أو تدوير أسرار JWT؛ لا تُعطّل الفحص التقاطعي.
3. **`quota_denied` لعميل واحد** → راجع `usage_counters` وخطة الاشتراك؛ لا ترفع الحد يدوياً بلا تدقيق.
4. **`signup_attempt` بلا `signup_ok`** → غالباً فشل تحقق (slug/كلمة مرور) أو تضارب `SLUG_TAKEN` (409).

## 4) ما هو جاهز كودياً وما هو غير منفّذ

**جاهز الآن (كود/ملفات):**
- `/api/saas/metrics/prometheus` — نفس صيغة Prometheus text 0.0.4، محمي بـJWT+admin/manager.
- `deploy/saas/prometheus.yml` + `deploy/saas/alerts.yml` — scrape وقواعد تنبيه (4 قواعد)، YAML مُتحقق منه.

**غير منفّذ صراحةً (infra):**
- لم يُنشر Prometheus/Alertmanager فعلياً ⇒ **لا تنبيهات تصل لأحد**.
- توكن الخدمة في `prometheus.yml` يُقرأ من Secrets Manager عند النشر — لم يُضبط.
- لا تجميع متعدد النسخ (كل نسخة عدّاداتها المحلية).
- لا SLO مجدول (`scripts/slo-check.js` للأهداف القديمة فقط ويحتاج cron).

هذه خطوات نشر على staging، وليست وعوداً برمجية.
