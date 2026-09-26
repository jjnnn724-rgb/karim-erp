# دليل CI/CD - karim ERP Pro
> **المرحلة 3.4 | أنظمة التكامل والنشر المستمر**

---

## نظرة عامة

تم إعداد **GitHub Actions** لأتمتة:

| المرحلة | الوصف | الحالة |
|---------|-------|--------|
| **Test** | تشغيل اختبارات الوحدة والتكامل | ✅ |
| **Security** | فحص الثغرات الأمنية في الاعتمادات | ✅ |
| **Quality** | فحص جودة الكود والإحصائيات | ✅ |
| **Build** | بناء الحزمة المستقلة (اختياري) | ✅ |
| **Deploy** | النشر لـ Staging/Production (يدوي) | ✅ |

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
  postgres:  # PostgreSQL 16
  redis:     # Redis 7
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

| البيئة | المشغل | الموافقة |
|--------|--------|----------|
| **Staging** | Manual dispatch | تلقائي |
| **Production** | Manual dispatch | يتطلب تأكيد |

---

## متغيرات البيئة المطلوبة

### للأمان (Secrets)

في **Settings → Secrets and variables → Actions**:

| المتغير | الوصف | مثال |
|---------|-------|------|
| `STAGING_SERVER` | عنوان خادم staging | `staging.example.com` |
| `PRODUCTION_SERVER` | عنوان خادم الإنتاج | `app.example.com` |
| `DEPLOY_KEY` | مفتاح SSH للنشر | `ssh-ed25519 AAAA...` |

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

*آخر تحديث: 2026-07-17*
