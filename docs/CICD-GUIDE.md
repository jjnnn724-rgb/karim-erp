# دليل CI/CD - karim ERP Pro

> **المرحلة 3.4 | أنظمة التكامل والنشر المستمر**

---

## نظرة عامة

تم إعداد **GitHub Actions** لأتمتة:

| المرحلة      | الوصف                              | الحالة |
| ------------ | ---------------------------------- | ------ |
| **Test**     | تشغيل اختبارات الوحدة والتكامل     | ✅     |
| **Security** | فحص الثغرات الأمنية في الاعتمادات  | ✅     |
| **Quality**  | فحص جودة الكود والإحصائيات         | ✅     |
| **Build**    | بناء الحزمة المستقلة (اختياري)     | ✅     |
| **Deploy**   | النشر لـ Staging/Production (يدوي) | ✅     |

---

## هيكل الملفات

```
.github/
└── workflows/
    └── ci-cd.yml          ← تعريف الـ pipeline الرئيسي

.env.example               ← نموذل متغيرات البيئة
```

---

## كيفية التشغيل

### 1. تلقائيًا عند Push/PR

```bash
# عند الدفع للفروع الرئيسية
git push origin main

# أو عند فتح Pull Request
git push origin feature/new-feature
# ثم افتح PR على GitHub
```

### 2. يدويًا (Manual Dispatch)

1. اذهب إلى **Actions** في مستودع GitHub
2. اختر **CI/CD Pipeline**
3. اضغط **Run workflow**
4. اختر البيئة:
   - `staging` - بيئة الاختبار
   - `production` - بيئة الإنتاج

---

## وظائف الـ Pipeline

### 🔬 Job 1: Test Suite

**يختبر**: جميع الاختبارات مع قاعدة بيانات و Redis حقيقيين

```yaml
services:
  postgres: # PostgreSQL 16
  redis: # Redis 7
```

**المخرجات**:

- تقرير تغطية الاختبارات (`coverage-report`)
- نتائج الاختبارات بالتفصيل

### 🔒 Job 2: Security Audit

**يفحص**:

- `npm audit` - ثغرات npm المعروفة
- `dependency-review-action` - مراجعة الاعتمادات الجديدة
- كشف الأسرار في الكود المصدري

**عتبات الفشل**:

- ثغرات `high` أو `critical` → تحذير
- ثغرات `moderate` → تسجيل فقط

### ✨ Job 3: Code Quality

**يقيس**:

- عدد ملفات JavaScript
- أسطر الكود الإجمالية
- عدد ملفات الاختبار
- تنسيق الكود (إذا كان Prettier مُعدّ)

### 📦 Job 4: Build Package

**يبني**:

- حزمة مستقلة باستخدام `pkg` (اختياري)
- أرشيف مصدري للإصدارات (`dist/karim-erp-pro-source.zip`)

**يُشغل فقط عند**:

- Push إلى `main`/`master`
- وجود tag يبدأ بـ `v`

### 🚀 Job 5: Deployment

**بيئات النشر**:

| البيئة         | المشغل          | الموافقة    |
| -------------- | --------------- | ----------- |
| **Staging**    | Manual dispatch | تلقائي      |
| **Production** | Manual dispatch | يتطلب تأكيد |

---

## متغيرات البيئة المطلوبة

### للأمان (Secrets)

في **Settings → Secrets and variables → Actions**:

| المتغير             | الوصف              | مثال                  |
| ------------------- | ------------------ | --------------------- |
| `STAGING_SERVER`    | عنوان خادم staging | `staging.example.com` |
| `PRODUCTION_SERVER` | عنوان خادم الإنتاج | `app.example.com`     |
| `DEPLOY_KEY`        | مفتاح SSH للنشر    | `ssh-ed25519 AAAA...` |

---

## تخصيص الـ Pipeline

### تعديل عتبات التغطية

```yaml
# في job test
- name: Check coverage thresholds
  run: |
    # أضف هنا فحص مخصص لعتبات التغطية
```

### إضافة خطوات نشر حقيقية

```yaml
# استبدل placeholder في deploy-staging
- name: Deploy via SSH
  uses: appleboy/ssh-action@master
  with:
    host: ${{ secrets.STAGING_SERVER }}
    username: deploy
    key: ${{ secrets.DEPLOY_KEY }}
    script: |
      cd /opt/karim-erp-pro
      git pull origin main
      npm ci --production
      pm2 restart gvp-api
```

### إضافة Slack/Discord إشعارات

```yaml
# أضف في نهاية الملف
notifications:
  slack:
    channel: '#deployments'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## أفضل الممارسات

### ✅ افعل هذا

1. **حماية الفروع**: فعّل branch protection rules
   - Require PR before merge
   - Require status checks to pass
   - Don't allow force pushes

2. **توقيع Commits**: فعّل GPG signing

   ```bash
   git config commit.gpgsign true
   ```

3. **Automated Dependencies**: فعّل Dependabot
   - أنشئ `.github/dependabot.yml`

4. **Environment Secrets**: لا تضع أسرار في الكود

### ❌ تجنب هذا

1. **لا تتجاوز الاختبارات**: لا تستخدم `[skip ci]`
2. **لا تخزن أسرار**: استخدم GitHub Secrets دائمًا
3. **لا تنشر مباشرة**: استخدم staging أولاً

---

## استكشاف الأخطاء

### المشكلة: فشل الاتصال بقاعدة البيانات

```yaml
# تأكد من صحة سلسلة الاتصال
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

### المشكلة: اختبارات تفشل محليًا لكن تنجح في CI

```bash
# شغل بنفس بيئة CI
docker-compose up -d postgres redis
npm test
```

### المشكلة: بطء الـ Pipeline

- استخدم `cache: 'npm'` في setup-node
- قلل عدد الخدمات (services)
- استخدم `concurrency` لإلغاء Runs القديمة

---

## المراجع

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Pino Logger](https://getpino.io/)
- [Zod Validation](https://zod.dev/)
- [Jest Testing](https://jestjs.io/)

---

_آخر تحديث: 2026-10-27_## فحص التنسيق (Prettier) — إعلامي (مُجدَّد بالأدلة)

- `npm run test:format` يفشل على **1124 ملفًا** (المستودع لم يُنسَّق بـPrettier قط)،
  فصار `continue-on-error` في 2026-10-21، ولمعند ذلك كان قرارًا مؤجَّلًا بلا بديل.
- **جُرّب تنسيق كامل في 2026-10-27 ثم رُجِع.** النتيجة التفصيلية:
  - `prettier --write .` نجح و`--check` صار خضراء تمامًا، لكن الاختبارات انكسرت:
    **102 من 272 ملفًا · 384 اختبارًا.**
  - السبب بنيوي لا عشوائي: الاختبارات في هذا المشروع اختبارات **«عقد المصدر»**
    تقرأ ملفات `.js` وتُطابقها بنمط regex — مثل
    `/app\.get\('\/metrics'/` و`/value: \(row\) => SEVERITY\[row\.stateKey\]/`.
    Prettier يغيّر الصياغة فعلًا: `arrowParens: 'avoid'` يحذف قوسًا حول وسيط
    واحد، و`printWidth: 120` يكسر العبارة على سطرين فيختفي التطابق.
  - ⇒ **التنسيق الكامل لا يُنفَّذ دفعة واحدة أبدًا** قبل إعادة كتابة اختبارات العقد.
- **العقد العملي:** التنسيق يكون تدريجيًا — ملف أو مجموعة ملفات في الـPR نفسه مع
  تحديث اختبارات «عقد المصدر» الخاصة بها، ثم يُخفَّض العدد في الأعلى تدريجيًا.
- ما يبقى صحيحًا من التجربة ومحفوظًا: `.prettierignore` يستثني مخرجات بناء
  أندرويد/إلكترون (كانت تسقط Prettier بـ`SyntaxError` على HTML مُجمَّع)، وظهرَّ فيها
  **خِلَلان HTML حقيقيان** أصلحهما: `frontend/index.html` (`<small>…</b>`) و
  `frontend/app/index.html` (`</body>` مكرّر يضع سكربت خارج الجسم).

## بوابة الأنواع (Type Ratchet) — حاجبة

- `npm run test:type` وحده **لا يفحص شيئًا يُذكر**: الإعداد الأساسي `checkJs: false`، وملف `.ts`
  واحد فقط في المشروع ⇒ يمرّ بلا كشف أي خطأ في 210 ملفات backend.
- `tsconfig.strict.json` هو «النادي الصارم»: مُتحقَّق منه أنه يخرج **صفر خطأ فعليًا** (لا يُعتمد على
  نتيجة غير مُتحقَّق منها — الملفات تُختار بعد اختبار كلٍّ منها بمفرده لأن ملفًا نظيفًا قد يستورد
  وحدة ملوّثة).
- `npm run test:type:ratchet` يفحص **backend كله** بـ`checkJs` ويقارن حصّة كل ملف بخط الأساس
  `scripts/type-ratchet-baseline.json` — نفس عقد `lint-gate.js`:
  1. ملف يتجاوز حصّته → فشل. 2. مجموع الأخطاء يتجاوز المجموع → فشل.
  2. ملف جديد بخطأ → حصّته صفر → فشل. 4. الأساس **يُخفَّض فقط** ولا يُرفع.
- التشغيل: `npm run test:type:ratchet` · التجديد بعد إصلاح دفعة:
  `npm run test:type:ratchet:baseline` (يُراجع في الـPR كأي تغيير آخر).
- حدود صادقة موثّقة: الحصة الحالية **6979 خطأ في 193 ملفًا** (كانت 8505 في 203 عند أول إصدار
  2026-10-27). الهدف تخفيضها تدريجيًا من الملفات الأصغر أولًا، لا رفعها أبدًا.
- **أعلى رافعة معروفة:** `pool` في `backend/shared-pool.js` هو `new Proxy({}, …)` فكان TypeScript
  يراه `{}` — وبذلك أخطأ في كل ملف ينادي `pool.query`. وسم نوع واحد على هدف الـProxy أزيل **1526
  خطأ** عبر المشروع كله دون تغيير سلوكي. ابحث عن نمط «كائن بلا نوع يمرّر النداءات» قبل إصلاح مئات
  الملفات واحدًا واحدًا.
