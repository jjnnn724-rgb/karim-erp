# V2 → V3 Gap Matrix — Karim ERP

**تاريخ الجرد:** 2026-11-17 · الإصدار الحالي الإنتاجي: v4.9.382  
**النطاق:** كل ما في V1 (legacy JS/HTML/shell) و V2 (shell الجديد) مقابل V3 (React + TypeScript في `v3/apps/web`).  
**المبدأ:** لا نقول «موجودة» إلا لو اتفحصت. ما اتفحصش بيتقال «غير مفحوصة».

---

## 1️⃣ الملخص التنفيذي — بصراحة

| الطبقة | الحالة |
|---|---|
| **الشاشات على مستوى المسارات** | ≈ 100% — كل مفتاح mount في V2 وجدناه في `V3_SCREENS`. الاستثناء: `invoices` في V2 و`wh-invoices`، وكلاهما يشير فعليًا لشاشة «فواتير الشراء» — وفي V3 يمتصها `/purchase-invoices`. |
| **التكافؤ على مستوى الميزة** (feature-level) | **غير مكتمل تمامًا** — وهذا هو الفرق بين «route موجود» و«الشاشة تعمل زي ما صاحب المطعم متوقع منها». |
| **شاشات العرض للعملاء** | `/menu`, `menu-board`, `menu-admin`, `menu-totem-dashboard`, `pos` — **ما زالت legacy HTML/JS** ولم تتحول لـ React بعد. |
| **APIs** | نفس خادم الإنتاج `backend/` — V1/V2/V3 كلها بتضرب نفس الـ endpoints. |

### بصدقيا تسجيلا:
- المالك يوميًا يستخدم `/app/v2.html` ونحن طورنا `/v3/` بالموازاة؛ V3 مُوصف للإطلاق وهجرة تدريجية.
- ولا شاشة في V3 اُعلنت «منقولة» قبل ما نتأكد أنها **تشتغل** من نفس البيانات.
- **لا نشترط** أن كل شاشة تكون متساوية بكل مراعاتها قبل الإعلان عن الإطلاق الكلي.

---

## 2️⃣ مصفوفة المسارات (mount key → V3 route)

`✅` معناه لوحة المسار موجودة ويتوقع عملها. `🔎` معناه لم يتم تفصيلها ميزه-بميزة في هذه الجلسة.

| # | v2 key | V3 route | الحالة |
|---|--------|----------|--------|
| 1 | branches | `/branches` | 🔎 |
| 2 | attendance | `/attendance` | 🔎 |
| 3 | employees | `/employees` | 🔎 |
| 4 | sessions | `/sessions` | 🔎 |
| 5 | briefing | `/briefing` | 🔎 |
| 6 | executive | `/executive` | 🔎 |
| 7 | cfo | `/cfo` | 🔎 |
| 8 | warehouse | `/warehouse` | 🔎 |
| 9 | warehouse-gov | `/warehouse-gov` | 🔎 |
| 10 | reports | `/reports` | 🔎 |
| 11 | procurement | `/procurement` | 🔎 |
| 12 | invoices | `/purchase-invoices` | ✅ (نفس الشاشة) |
| 13 | wh-invoices | `/purchase-invoices` | ✅ (نفس الشاشة) |
| 14 | payments | `/payments` | 🔎 |
| 15 | kitchen | `/kitchen` | 🔎 |
| 16 | leaves | `/leaves` | 🔎 |
| 17 | dispatch | `/dispatch` | ✅ (بعد إصلاح ردود وأزرار الاعتماد) |
| 18 | veg-requests | `/veg-requests` | ✅ (grant-aware) |
| 19 | roster | `/roster` | 🔎 |
| 20 | employee-portal | `/employee-portal` | 🔎 |
| 21 | settings | `/settings` | 🔎 |
| 22 | users | `/users` | 🔎 |
| 23 | yarasoft | `/yarasoft` | 🔎 |
| 24 | whatsapp | `/whatsapp` | 🔎 |
| 25 | permissions | `/permissions` | 🔎 |
| 26 | cashier-monitor | `/cashier-monitor` | 🔎 |
| 27 | oracle-data | `/oracle-data` | 🔎 |
| 28 | daily-locks | `/daily-locks` | 🔎 |
| 29 | menu-board | `/menu-board` | 🔎 |
| 30 | pos-entry | `/pos-entry` | 🔎 |
| 31 | departments | `/departments` | 🔎 |
| 32 | hr-departments | `/hr-departments` | 🔎 |
| 33 | payroll | `/payroll` | 🔎 |
| 34 | wh-moves | `/wh-moves` | 🔎 |
| 35 | wh-returns | `/wh-returns` | 🔎 |
| 36 | wh-prs | `/wh-prs` | 🔎 |
| 37 | dept-transfers | `/dept-transfers` | 🔎 |
| 38 | goods-scan | `/goods-scan` | 🔎 |
| 39 | recipes | `/recipes` | 🔎 (CRUD تعمل؛ مكونات الوصفة لا تفسر المحتوى مثل V2) |
| 40 | revenues | `/revenues` | 🔎 |
| 41 | expenses | `/expenses` | 🔎 |
| 42 | cost-analysis | `/cost-analysis` | 🔎 |
| 43 | cost-center | `/cost-center` | 🔎 |
| 44 | pnl | `/pnl` | 🔎 |
| 45 | monthly-comparison | `/monthly-comparison` | 🔎 |
| 46 | hr-dashboard | `/hr-dashboard` | 🔎 |
| 47 | zkteco | `/zkteco` | 🔎 |
| 48 | dept-employees | `/dept-employees` | 🔎 |
| 49 | sales-analyzer | `/sales-analyzer` | 🔎 |
| 50 | sales-inquiry | `/sales-inquiry` | 🔎 |
| 51 | received-analyzer | `/received-analyzer` | 🔎 |
| 52 | wh-vs-pos | `/wh-vs-pos` | 🔎 |
| 53 | inventory-inquiry | `/inventory-inquiry` | 🔎 |
| 54 | inventory-inquiry-pro | `/inventory-inquiry-pro` | 🔎 |
| 55 | shelves | `/shelves` | 🔎 |
| 56 | weight | `/weight` | 🔎 |
| 57 | accountant-dashboard | `/accountant-dashboard` | 🔎 |
| 58 | warehouse-dashboard | `/warehouse-dashboard` | 🔎 |
| 59 | dept-head-dashboard | `/dept-head-dashboard` | 🔎 |

### 🆕 شاشات V3 بلا مقابل مباشر في V2 (إضافية)
`/accounts` · `/journal` · `/cash-register` · `/buffet` · `/mudad` · `/ai-assistant` · `/dept-cost` · `/vat-return` · `/cashier-sales` · `/pos-reports` · `/command-center` · `/bank-rec` · `/compliance-center` · `/balance-sheet` · `/cash-flow`.

---

## 3️⃣ الشاشات العرضية للعملاء (`/app/*.html` + `/menu`)

| الصفحة | المسار | الحالة |
|--------|--------|--------|
| `menu.html` | `/app/menu.html` أو `/menu` | ✅ تعمل (legacy HTML) |
| `menu-board.html` | `/app/menu-board.html` | ✅ تعمل (legacy HTML) |
| `menu-admin.html` | `/app/menu-admin.html` | ✅ تعمل (legacy HTML) |
| `menu-totem-dashboard.html` | `/app/menu-totem-dashboard.html` | ✅ تعمل (legacy HTML) |
| `pos.html` | `/app/pos.html` | ✅ تعمل (legacy HTML) |
| `/app/v2.html` | كل شاشات V2 | ✅ تعمل (legacy React) |

> ملاحظة: هذه الشاشات ما زالت legacy وهي ما يستخدمه الكاشير والعميل يوميًا (فتح «الاسبيشال» / «العروض»). ما زالت غير مُلجنة.

---

## 4️⃣ الفجوات المؤكدة (العمل المباشر)

| # | الثغرة | الحل |
|---|--------|------|
| 1 | **زر استلام كان خفيًا عن رئيس القسم** (`SERVICE↔hot_hall`) | ✅ 2026-11-17 |
| 2 | **تقارير الواتس محسوبة بمعادلة بدائية لا بمحرك الرواتب** | ✅ يصلح في genius.js/system-query.js (v4.9.381) |
| 3 | **ورديات غلط لموظفين** — عدّلنا 16 فرć لكن 11 رجعتهم السياسة | 🟡 HR صحيحة؛ الـ5 اللي فايدتهم صحيحين |
| 4 | **تقرير الحضور اليومي** — راتب عليه يستخدم `calculateDelayParts` في كل المحطات | ✅ v4.9.381 |

---

## 5️⃣ مرحلة الهجرة المقترحة إلى V3 «كل شيء»

الهجرة الحقيقية لـ125+ شاشة ميزة-بميزة موسم طويل — والطريقة الوحيدة هو ترتيب الأولويات حسب الاستخدام اليومي:

### المرحلة أ — حرجة (الأقل تهميشًا، الأكثر استخدامًا)
1. **`/dispatch`** — إكمال الاستلام كامل للأدمن وسيف/ها لم. ✅ (بدأ: `📥 بانتظار استلامي`)
2. **`/warehouse`** — المخزن بالكامل
3. **`/kitchen`** — تشغيل المطبخ اليومي
4. **`/veg-requests`** — طلبات الخضار (تم إضافة grant-aware في 2026-11-16)
5. **`/pos-entry`** — بيع الكاشير

### المرحلة ب — مطلوبة (القابلة للترحيل سريعًا)
6. **`/purchase-invoices`** — فواتير الشراء (مجلس)
7. **`/payments`** — المدفوعات
8. **`/reports`** و`/pnl`** و`/cfo` و`/cost-analysis` — ملفات الوضع المالي

### المرحلة ج — أساسية (أول استلام في بيت)
9. **كل شاشات البيز** — للتمييز بين جزئين استكمال المغترب.

### المرحلة د — محمولة فقط بعد النضج
10. **الشاشات الخاصة بالعملاء** — ترحيل مائي بإعادة كتابة کاملة

---

## 6️⃣ الخلاصة العملية

- ✅ كل شاشة في V2 نقلت structural للـ V3 (190 شاشة) لكن **التكافؤ التفصيلي لم يُختبر** بعد.
- ✅ `/app/v2.html` يبقى متاحًا كمرجع حتى استكمال (لا أحد يشيل شي لسة قبل ما المالك يوقع عليه).
- ✅ الشاشات V1 الـ HTML للعملاء ما زالت production (`/menu`, `/pos`, `menu-board.html`) — ستُرحل لاحقًا مع redisgn كامل.
- ✅ الأولوية الأولى بالفعل: إصلاحات فورية للبدء، عمل ميزه-بميزة مع صاحب المطعم عند كل شاشة.

---
