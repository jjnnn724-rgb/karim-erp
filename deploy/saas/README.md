# SaaS staging — ملفات جاهزة (لم تُنشر)

هذا المجلد يحتوي **إعدادات فقط** لبيئة staging متعددة المستأجرين. لم يُشغَّل أي شيء،
ولم يُنشر Prometheus/Alertmanager، ولم يتصل النظام بقاعدة staging من هذه الجلسة.

**النطاق المقرر:** `karimeg.online` (staging: `staging.karimeg.online`،
ومستأجر: `<slug>.staging.karimeg.online`). التفاصيل في `DNS-and-TLS.md`.

## الملفات
| الملف | الغرض |
|---|---|
| `docker-compose.staging.yml` | db + redis + app + prometheus + alertmanager على شبكة داخلية |
| `.env.staging.example` | المتغيرات المطلوبة (بلا أسرار — تُملأ من Secrets Manager) |
| `nginx-wildcard.conf` | توجيه `*.staging.<domain>` إلى التطبيق مع WebSocket وHSTS |
| `prometheus.yml` / `alerts.yml` | scrape + 4 قواعد تنبيه |
| `alertmanager.yml` | قالب توجيه **بلا مستقبل خارجي** — يجب ضبطه قبل الاعتماد |

## ترتيب التشغيل الآمن
1. انسخ `.env.staging.example` إلى `.env.staging` واملأ الأسرار من مدير الأسرار.
2. شغّل قاعدة/staging فقط: `docker compose -f docker-compose.staging.yml --env-file .env.staging up -d db redis`.
3. طبّق الترحيلات **155..163** على `karim_erp_staging` عبر الحارس:
   ```
   node scripts/saas-migrate-guard.js --target=karim_erp_staging \
     --migration=<file> --i-confirm-copy --dry-run
   ```
   (غيّر الحارس ليسمح باسم staging عند النشر الفعلي — موثّق في الكود.)
4. طابق الأرقام: `accounting-reconciliation.js` + `verify-audit-chain.js` + `baseline-*.json`.
5. فقط بعد نجاح المطابقة: `SAAS_TENANT_ENABLED=true` ثم تشغيل باقي الخدمات.
6. راجع `docs/SAAS-SLO.md` قبل الاعتماد على التنبيهات.

## لماذا لم يُفعّل من هنا؟
لأن تشغيله يحتاج قرارك: اسم النطاق، مكان الأسرار، وجهة التنبيهات، ونوع بوابة الدفع.
كلها infra/قرارات مش مجرد كود.
