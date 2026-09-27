# 🔧 دليل الإصلاح والتشغيل - karim ERP

## 📋 ملخص الإصلاحات المطبقة

✅ **تم إصلاح:**
- إصدارات التبعيات غير الصحيحة في `package.json`
- إزالة التبعيات غير المتاحة
- تحديث الحد الأدنى من الاعتماديات

---

## 🚀 الخطوات لتشغيل المشروع

### الخطوة 1: التحقق من المتطلبات

```bash
# تحقق من إصدار Node.js (يجب أن يكون >= 18.0.0)
node --version
# الحد الأدنى المطلوب: v18.0.0
# الإصدار الموصى به: v20.0.0 أو أحدث

# تحقق من npm
npm --version
# الحد الأدنى: 8.0.0
```

### الخطوة 2: تثبيت التبعيات

```bash
cd karim-erp

# طريقة 1: التثبيت العادي (الأفضل)
npm install

# طريقة 2: إذا حدثت مشاكل مع التوافقية
npm install --legacy-peer-deps

# طريقة 3: مسح الـ cache وإعادة المحاولة
npm cache clean --force
npm install
```

### الخطوة 3: تشغيل المشروع

#### للتطوير (مع DevTools)
```bash
npm run electron:dev
```
- يفتح نافذة Electron مع أدوات المطور
- يسمح بإعادة تحميل سريعة
- مثالي للاختبار والتطوير

#### للإنتاج (بناء EXE)
```bash
# بناء نسخة NSIS (مع مثبت)
npm run electron:build:nsis

# بناء نسخة محمولة (بدون تثبيت)
npm run electron:build:portable

# النسخ ستكون في مجلد release/
```

#### تشغيل السيرفر فقط
```bash
npm start
# يبدأ خادم Express على http://localhost:5000
```

---

## 🐛 استكشاف الأخطاء

### المشكلة 1: خطأ "Cannot find module"

**الأعراض:**
```
Error: Cannot find module 'express'
```

**الحل:**
```bash
# تأكد من أن node_modules موجود
ls node_modules/

# إذا لم يكن موجوداً، أعد التثبيت
npm install

# أو مسح وإعادة البناء
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### المشكلة 2: خطأ "Port already in use"

**الأعراض:**
```
Error: listen EADDRINUSE: address already in use :::5000
```

**الحل:**
```bash
# تغيير المنفذ
PORT=5001 npm start

# أو إيقاف البروسيس الأخرى
# على Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# على Linux/Mac
lsof -i :5000
kill -9 <PID>
```

### المشكلة 3: خطأ PostgreSQL

**الأعراض:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**الحل:**
```bash
# تحقق من أن PostgreSQL يعمل
npm run status

# ابدأ PostgreSQL يدوياً (إذا لم يبدأ تلقائياً)
# على Windows
database/bin/pg_ctl start -D database/data

# على Linux
./database/bin/pg_ctl start -D database/data
```

### المشكلة 4: أخطاء Electron

**الأعراض:**
```
Error: Failed to require /path/to/main.js
```

**الحل:**
```bash
# امسح الـ cache
rm -rf node_modules/.cache

# أعد تثبيت
npm install --no-save electron@28.3.3

# أو استخدم electron-rebuild
npx electron-rebuild
```

---

## 🧪 الاختبارات

### تشغيل جميع الاختبارات
```bash
npm test
```

### الاختبارات السريعة (Smoke Tests)
```bash
npm run smoke
```

### اختبارات التكامل
```bash
npm run integration
```

### اختبار نقطة البيع
```bash
npm run pos-sale
```

### اختبار التجاوب (Responsive)
```bash
npm run responsive
```

---

## 🗄️ إدارة قاعدة البيانات

### النسخ الاحتياطي
```bash
npm run backup
# ينشئ نسخة احتياطية في database/backups/
```

### الاستعادة من نسخة احتياطية
```bash
npm run restore
# يستعيد من آخر نسخة احتياطية
```

### تطبيق الترقيات (Migrations)
```bash
npm run migrate
# يطبق جميع ملفات SQL في database/migrations/
```

### إعادة تعيين البيانات (للاختبار فقط)
```bash
npm run reset
# ⚠️ تحذير: هذا سيمسح جميع البيانات!
```

---

## 📊 الأوامر المفيدة

### عرض عنوان IP المحلي
```bash
npm run show-ip
# يعرض عناوين IP الشبكة
# يمكنك استخدامها للوصول من الهاتف/التابلت
```

### فحص حالة النظام
```bash
npm run status
# يعرض حالة PostgreSQL و Express Server
```

### إيقاف النظام بشكل آمن
```bash
npm run stop
# يوقف العمليات بشكل صحيح وآمن
```

---

## 🔐 التكوين الأمني

### ملف .env

```bash
# انسخ الملف النموذجي
cp .env.example .env

# حرر الملف وأضف البيانات الخاصة بك
cat .env
```

### محتوى .env الأساسي

```env
# الخادم
PORT=5000
NODE_ENV=production

# قاعدة البيانات
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_NAME=karim_erp
DB_HOST=localhost
DB_PORT=5432

# الأمان
JWT_SECRET=your_super_secret_jwt_key_here
API_KEY=your_api_key_here

# البريد الإلكتروني (اختياري)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Cloudflare (اختياري)
CLOUDFLARE_TUNNEL_ID=your_tunnel_id
CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token

# CORS
ALLOWED_ORIGINS=http://localhost:5000,http://192.168.*

# المسارات
MEDIA_ROOT=./database/media
BACKUP_PATH=./database/backups
```

⚠️ **تحذير أمني:**
- لا تشارك ملف `.env` مع أحد
- استخدم كلمات مرور قوية
- غير البيانات الافتراضية قبل الإنتاج

---

## 📱 الوصول من الشبكة المحلية

### خطوات الوصول من الهاتف/التابلت

1. **ابدأ التطبيق الرئيسي على الحاسب:**
   ```bash
   npm start
   ```

2. **احصل على عنوان IP:**
   ```bash
   npm run show-ip
   # سيعرض شيء مثل: 192.168.1.100
   ```

3. **على الهاتف، افتح المتصفح:**
   ```
   http://192.168.1.100:5000/app/index.html
   ```

4. **تسجيل الدخول:**
   - اسم المستخدم: admin
   - كلمة المرور: (كما تم تعيينها)

---

## 🎯 حالات الاستخدام

### حالة 1: جهاز كاشير واحد (الإعداد البسيط)

```bash
# على جهاز الكاشير فقط
npm start

# ثم افتح http://localhost:5000 في المتصفح
```

### حالة 2: شبكة متعددة الأجهزة (الإعداد المتقدم)

```bash
# على الجهاز الرئيسي (الخادم)
npm start
npm run show-ip  # احفظ عنوان IP

# على أجهزة أخرى (الكاشير، المطبخ، الحضور)
# افتح المتصفح واذهب إلى:
http://<server-ip>:5000/app/index.html
```

### حالة 3: إعداد Electron (الإنتاج الموصى به)

```bash
# بناء التطبيق
npm run electron:build:nsis

# ستجد ملف التثبيت في: release/
# وزعه على الأجهزة وثبته بشكل طبيعي
```

---

## 📈 تحسينات الأداء

### تقليل استهلاك الذاكرة
```bash
# قلل من عدد اتصالات قاعدة البيانات
NODE_OPTIONS="--max-old-space-size=512" npm start
```

### زيادة سرعة المعالجة
```bash
# استخدم جميع مراكز المعالجة
NODE_ENV=production npm start
```

### مراقبة الأداء
```bash
# استخدم أدوات مراقبة Node.js
npm install -g clinic
clinic doctor -- npm start
```

---

## 🔄 التحديثات والصيانة

### التحقق من التحديثات
```bash
npm outdated
# يعرض التبعيات المتقادمة
```

### تحديث التبعيات بحذر
```bash
# تحديث تصحيح الأخطاء فقط (آمن)
npm update

# تحديث minor version (احذر)
npm install express@latest

# تحديث جميع التبعيات (قد يسبب مشاكل)
npm install -g npm-check-updates
ncu -u
```

---

## 🆘 الدعم الفني

### الحصول على معلومات التشخيص
```bash
# معلومات النظام
npm run status

# سجلات الأخطاء (إن وجدت)
cat logs/error.log

# معلومات قاعدة البيانات
npm run show-ip
```

### الاتصال بالدعم
- 📧 البريد: support@karim-erp.com
- 🌐 الموقع: https://karim-erp.com
- 📖 التوثيق: ./docs/
- 🐛 الأخطاء: GitHub Issues

---

## ✅ قائمة التحقق قبل الإنتاج

- [ ] تحديث ملف .env بالبيانات الفعلية
- [ ] تغيير كلمات المرور الافتراضية
- [ ] إنشاء نسخة احتياطية من قاعدة البيانات
- [ ] اختبار جميع الميزات
- [ ] اختبار الوصول من الشبكة المحلية
- [ ] فحص الأمان والتصريحات
- [ ] توثيق الإعدادات
- [ ] تجهيز خطة الطوارئ
- [ ] تدريب المستخدمين
- [ ] مراقبة مستمرة

---

<div align="center">

### 🦅 karim ERP - نظام إدارة المطاعم المتكامل

**تم التحديث:** 24 أغسطس 2026  
**الحالة:** ✅ جاهز للتشغيل

Made with ❤️ by karim Team

</div>
