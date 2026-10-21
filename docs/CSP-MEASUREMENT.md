# تقرير قياس CSP — قرار فرض السياسة الصارمة

> الحالة: **القياس مفعّل على الإنتاج (Report-Only)** · التاريخ: 2026-10-21
> الخلاصة في سطر واحد: **فرض السياسة الصارمة الآن يكسر الواجهة** (1158 معالجًا سطريًا)،
> لكن القياس collecting el 놓고 خللًا إنتاجيًا حقيقيًا أصلحناه، والباقي قرار مالك.

---

## 1. كيف نُقيس (والأداة)

| الطبقة | التفصيل |
|---|---|
| المتصفح | Chrome حقيقي على `https://karimeg.online` (الإنتاج الفعلي) + sandbox محلي |
| الترويسة | `Content-Security-Policy-Report-Only` (لا يحجب شيئًا) مع `report-uri` |
| الاستقبال | `POST /api/security/csp-report` (عام، محدود المعدّل 600/دقيقة لكل IP، 64KB) |
| القراءة | `GET /api/security/csp-report` (**محمية بمفتاح التطبيق** — تكشف بنية الملفات) |
| الديمومة | `logs/csp-violations.jsonl` (مصرف دائم — العدّاد في الذاكرة يُفقد عند Restart) |
| التقرير | `npm run csp:report` (توجيه / مستند / موضع ⇒ قائمة إصلاح) |

القياس مُفعَّل على الإنتاج بـ `CSP_STRICT_REPORT_ONLY=true` في `.env` (Report-Only ⇒ صفر تغيير سلوكي).
ملاحظة مهمة: **تقرير المتصفح جزئي** (بلّغ 3 معالجات في صفحة واحدة بينما الحقيقي 1158)،
لذا الرقم الحاسم جاء من **مدقّق ثابت** (`npm run test:handlers:budget`) لا من المتصفح.
## 2. ما الذي يمنع فرض السياسة الصارمة الآن؟

| المخالفة | العدد | الأثر |
|---|---|---|
| `script-src-attr` (معالجات `onclick=…`) | **1158** في 45 ملفًا | **حاجز الفرض** — كسر الواجهة بالكامل |
| `script-src-elem` (سكربتات inline) | 0 بعد الإصلاح | أُصلح (انظر §4) |
| `script-src` (سكربت Cloudflare beacon) | 1 | يحتاج `https://static.cloudflareinsights.com` صريحًا |
| `script-src-elem` (سكربت يحقنه Cloudflare على الحافة) | 1 | يُحجب اليوم أيضًا (سلوك سابق) |
| `frame-ancestors` على `/` | 3 | أثر ضئيل — ملاحظة |

**الخلاصة:** وحدها الـ1158 معالجًا سطريًا هي مانعة الفرض. تحويلها إلى
`addEventListener` عمل ميكانيكي على دفعات (أسبوع-أسبوع)، لا يوم.

## 3. المسار المقترح (قرار المالك)

1. **الآن**: السياسة المطبَّقة تبقى كما هي (معالجات مسموحة، سكربتات inline ممنوعة) + بوابة ميزانية تمنع أي زيادة.
2. **خلال 2–4 أسابيع**: تحويل المعالجات في أعلى الملفات استخدامًا (warehouse 203، kitchen 167، yarasoft 79، hr 75، settings-users 64) وخفض خط الأساس بعد كل دفعة.
3. **عندما يصل العدد إلى صفر**: فرض `script-src-attr 'none'` على دفعات (صفحة صفحة) مع إبقاء القياس مفعّلًا ومراقبًا.
4. **قبل الفرض**: اسمح صراحةً لـ `https://static.cloudflareinsights.com` (Cloudflare RUM) وقرّر مصير السكربت الذي يحقنه Cloudflare على الحافة (يُحجب اليوم — مقبول أم لا).

## 4. خلل إنتاجي اكتشفه القياس وأُصلح

**السبب الجذري:** السياسة تحمل `'nonce-…'` و`'unsafe-inline'` في نفس المصدر.
قاعدة CSP2: **وجود nonce يجعل المتصفح يتجاهل `'unsafe-inline'`** ⇒ كل سكربت inline
كان **يُحجب بصمت ولا يُنفَّذ**.

الأثر الحقيقي المقيس على الإنتاج:

| الموضع | الأثر قبل الإصلاح |
|---|---|
| `pos.html` (تهيئة مسار POS + تسجيل Service Worker) | **لم تكن تعمل إطلاقًا** — خاصية Phase 4.2 صامتة بلا أثر، والـSW لا يُسجَّل من شاشة الكاشير |
| `menu.html` (شاشة البوفيه القديمة) | **ميتة**: `DEFAULT_DATA` غير معرّف، **0 عناصر معروضة**، وTailwind CDN محجوب بسياسة `script-src 'self'` |
| Cloudflare-injected script (على الحافة) | محجوب (سلوك سابق — غير متعلق بتغييرنا) |

**الإصلاح:**
- `frontend/app/js/pos-bootstrap.js` — تهيئة الـPOS في ملف خارجي (تعمل الآن ✓).
- `frontend/app/js/features/menu-legacy.js` — منطق البوفيه القديم منقول خارج HTML (استخراج آلي، بلا تغيير سلوكي).
- `backend/server.js` — `/app/menu.html` يوجّه إلى `/app/menu-board.html` (الشاشة الحيّة، بنمط التحويلات القديمة القائمة).
- `backend/middleware/security.js` — `'unsafe-inline'` محذوف من `script-src` صراحةً ⇒ **سياسة صادقة** (لا تناقض صامت).
- **بوابة CI جديدة**: `npm run test:inline-scripts:gate` — صفر سكربت inline (رافعة تمنع تكرار الخلل).
- **بوابة الميزانية**: `npm run test:handlers:budget` — لا زيادة في الـ1158.

## 5. القياس بعد الإصلاح (إنتاج حقيقي)

```
/app/pos.html        → 0 مخالفات CSP          ✓ (كانت 2)
/app/index.html      → script-src-attr فقط (المعالجات السطرية — 1158)
/app/menu-board.html → سكربت Cloudflare فقط    ✓ (الشاشة تعمل)
```

## 6. ملفات ذات صلة

- `backend/middleware/security.js` — `buildCspDirectives` (المطبَّقة) و`buildStrictCsp` (الصارمة) و`createCspReportCollector`.
- `backend/csp-violation-log.js` — المصرف الدائم (JSONL، بلا كتابة في القاعدة).
- `scripts/audit-csp-inline-handlers.js` — المدقّق الثابت (المعالجات + سكربتات inline).
- `scripts/summarize-csp-violations.js` — تقرير قابل للقرار (`npm run csp:report`).
- `scripts/inline-handlers-baseline.json` — ميزانية الـ1158 (لا تُرفع).
- `tests/csp-strict-measurement.test.js` · `tests/csp-violation-log.test.js` · `tests/csp-inline-scripts.test.js` · `tests/integration/static-routes.js`.
