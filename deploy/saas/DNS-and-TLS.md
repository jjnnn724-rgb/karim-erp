# DNS & TLS — karimeg.online

النطاق المقرر: **`karimeg.online`**. الوجهة المقترحة للـstaging: `staging.karimeg.online`،
وكل مستأجر له نطاق فرعي: `<slug>.staging.karimeg.online`.

## سجلات DNS المطلوبة
| النوع | الاسم | القيمة |
|---|---|---|
| A / AAAA | `staging.karimeg.online` | IP لحافة staging (أو CNAME إلى نفق Cloudflare) |
| A / AAAA | `*.staging.karimeg.online` | نفس IP — يغطي كل المستأجرين بسجل واحد |
| CNAME (اختياري) | `karimeg.online` | `staging.karimeg.online` بعد الإطلاق |

## الشهادة
- شهادة **wildcard** للاسم `*.staging.karimeg.online` (تغطي `staging` نفسها حسب CA).
- تُخزَّن في `/etc/nginx/certs/wildcard.crt|key` خارج Git، وتُحقن من Secrets Manager.
- لا تُستخدم شهادة self-signed في staging يمكن الوصول إليها من المتصفح.

## مساران للوصول (اختر واحداً)
1. **Cloudflare Tunnel (الأقرب للوضع الحالي):** نفق واحد `karim-saas` مع Public Hostname
   `*.staging.karimeg.online` → `http://127.0.0.1:5300` (النسخة المعزولة — **ليس 5200**). الخادم يستخرج المستأجر من `Host`،
   فلا حاجة لتعديلات توجيه داخل التطبيق.
2. **Nginx على الحافة:** استخدم `nginx-wildcard.conf` في هذا المجلد، مع فتح 80/443 فقط.

## تنبيه أمني
`nginx-wildcard.conf` يمرّر `X-Forwarded-Host` — لكن الكود يتحقق منه بعد منع
القيم غير الصالحة (slug منفصل، لا مسارات، لا محارف تحكم). لا تسمح بـ`X-Tenant-ID`
من أي وكيل؛ المستأجر يُحل من النطاق فقط.
