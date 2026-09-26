# دليل بناء تطبيق Electron - karim ERP 🦅

## نظرة عامة

هذا الدليل يشرح كيفية بناء تطبيق **karim ERP 🦅** كتطبيق سطح مكتب باستخدام **Electron** مع ملف تثبيت موحد (Setup.exe) عبر **NSIS**.

---

## المتطلبات الأساسية

### 1. بيئة التطوير
```bash
# Node.js >= 18.0.0
node --version

# npm >= 9.0.0
npm --version
```

### 2. الملفات المطلوبة
```
project-root/
├── electron/
│   ├── main.js          # ← ملف Electron الرئيسي
│   └── preload.js       # ← Security bridge
├── backend/
│   └── server.js        # ← Express Server
├── frontend/
│   └── app/             # ← Frontend Files
├── database/
│   ├── bin/             # ← PostgreSQL Portable binaries
│   ├── scripts/         # ← DB Management Scripts
│   └── migrations/      # ← SQL Migrations
├── build/
│   ├── icon.ico         # ← Application Icon
│   └── installer.nsh    # ← Custom NSIS Script
└── package.json         # ← Updated with electron-builder
```

---

## هيكل العمل

### 1. عند بدء تشغيل التطبيق

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. إنشاء System Tray (أيقونة شريط المهام)                  │
│                         ↓                                    │
│  2. فتح نافذة BrowserWindow                                 │
│                         ↓                                    │
│  3. تشغيل PostgreSQL Portable (pg_ctl.exe)                   │
│     - التحقق من وجود مجلد البيانات                           │
│     - تهيئة قاعدة البيانات إذا كانت جديدة                    │
│     - تكوين الوصول من الشبكة (listen_addresses = '*')        │
│                         ↓                                    │
│  4. انتظار جاهزية PostgreSQL (Health Check)                  │
│                         ↓                                    │
│  5. تشغيل Express Server على 0.0.0.0:5000                    │
│     - لتمكين الوصول من أجهزة الشبكة                        │
│                         ↓                                    │
│  6. تحميل واجهة المستخدم في النافذة                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. Graceful Shutdown Sequence

```
إغلاق النافذة / الخروج
         ↓
┌─────────────────────────────────┐
│  1. إرسال SIGTERM للـ Express    │  ← إغلاق الاتصالات الحالية
│     (Timeout: 10 ثواني)          │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  2. إيقاف PostgreSQL بـ pg_ctl   │  ← حفظ البيانات المؤقتة
│     stop -m fast                 │  ← (Timeout: 20 ثانية)
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  3. تنظيف العمليات الفرعية      │  ← Force kill إذا لزم الأمر
└──────────────┬──────────────────┘
               ↓
           app.exit(0)
```

---

## أوامر البناء والتشغيل

### 1. التثبيت والتهيئة (مرة واحدة)

```bash
# استنساخ المشروع وتثبيت الاعتماديات
git clone <repository-url>
cd karim-erp-pro
npm install

# تحميل PostgreSQL Portable (اختياري - سيُحمَّل تلقائياً)
npm run download-pg

# تجهيز ملفات HTML
npm run patch-html
```

### 2. وضع التطوير (Development)

```bash
# تشغيل مع Electron في وضع التطوير
npm run electron:dev
```

**المميزات في وضع التطوير:**
- DevTools مفتوح تلقائياً
- إعادة تشغيل تلقائي عند تغيير الكود (Hot Reload)
- سجلات تفصيلية في الطرفية

### 3. البناء للإنتاج (Production)

#### أ. بناء NSIS Installer (التثبيت التقليدي)

```bash
npm run electron:build:nsis
```

**الناتج:** `release/Karim ERP 🦅-Setup-2.1.0.exe`

**المميزات:**
- معالج تثبيت احترافي مع واجهة عربية/إنجليزية
- اختيار مسار التثبيت
- اختصارات سطح المكتب وقائمة ابدأ
- قاعدة بيانات Windows Firewall تلقائياً
- خيار الإلغاء مع حذف/احتفاظ بالبيانات

#### ب. بناء Portable Version (بدون تثبيت)

```bash
npm run electron:build:portable
```

**الناتج:** `release/Karim ERP 🦅-Portable-2.1.0.exe`

**المميزات:**
- ملف تنفيذي واحد يعمل مباشرة
- لا يحتاج تثبيت
- مناسب للاستخدام من USB Flash Drive

---

## مخرجات البناء

### محتويات ملف التثبيت (NSIS)

```
karim ERP 🦅-Setup-2.1.0.exe
└── عند التثبيت → C:\Program Files\karim ERP 🦅\
    ├── karim ERP 🦅.exe          # Electron Runtime + App Code (asar)
    ├── resources/
    │   ├── app.asar                # التطبيق مضغوط
    │   └── database/bin/           # PostgreSQL Binaries (unpacked)
    ├── icon.ico
    ├── Network-Info.txt
    └── (اختصارات سطح المكتب)
```

### المسارات بعد التثبيت

| المحتوى | المسار |
|---------|--------|
| ملفات البرنامج | `C:\Program Files\karim ERP 🦅\` |
| بيانات قاعدة البيانات | `%APPDATA%\karim ERP 🦅\database\data\` |
| النسخ الاحتياطية | `%APPDATA%\karim ERP 🦅\database\backups\` |
| ملف الإعدادات | `%APPDATA%\karim ERP 🦅\.env` |

---

## الوصول من الشبكة المحلية (LAN)

### تكوين الشبكة

بعد تشغيل التطبيق، يمكن لأجهزة أخرى في الشبكة الوصول عبر:

```
http://<IP-ADDRESS-OF-CASHIER>:5000/app/index.html
```

### أمثلة:

| الجهاز | عنوان URL |
|--------|-----------|
| الكاشير (الجهاز الرئيسي) | `http://localhost:5000/app/index.html` |
| شاشة المطبخ | `http://192.168.1.100:5000/app/index.html` |
| هاتف حضور الموظفين | `http://192.168.1.100:5000/app/index.html` |

### العثور على عنوان IP

**Windows:**
```cmd
ipconfig
```

**من داخل التطبيق:**
- انقر بزر الماوس الأيمن على أيقونة **System Tray**
- اختر **"عرض عنوان IP"**

---

## استكشاف الأخطاء وإصلاحها

### المشكلة: "لم يتم العثور على pg_ctl.exe"

**الحل:**
1. تأكد من وجود `database/bin/pg_ctl.exe`
2. أو شغّل `npm run download-pg` لتحميل PostgreSQL

### المشكلة: المنفذ 5000 مستخدم بالفعل

**الحل:**
1. أغلق التطبيقات التي تستخدم المنفذ 5000
2. غيّر المنفذ في `.env`: `PORT=3000`

### المشكلة: لا يمكن الوصول من أجهزة أخرى

**الحل:**
1. تأكد أن Windows Firewall يسمح بالمنفذ 5000
2. تأكد أن كلا الجهازان في نفس الشبكة
3. جرب تعطيل مؤقتاً لمكافحة الفيروسات

### المشكلة: قاعدة البيانات لا تبدأ

**الحل:**
1. احذف مجلد `database/data` وأعد تشغيل التطبيق
2. تحقق من سجل PostgreSQL: `database/data/server.log`

---

## مقارنة بين طرق التوزيع

| الميزة | NSIS Installer | Portable | Old Method (pkg) |
|---------|---------------|----------|------------------|
| حجم الملف | ~150 MB | ~150 MB | ~120 MB |
| يحتاج تثبيت | نعم | لا | لا |
| اختصارات سطح المكتب | ✓ | ✗ | ✗ |
| إدخال Firewall تلقائي | ✓ | يدوي | يدوي |
| إلغاء التثبيت نظيف | ✓ | ✗ | ✗ |
| التحديث التلقائي | جاهز | غير مدعوم | غير مدعوم |
| مناسب لـ USB | لا | ✓ | ✓ |
| مظهر احترافي | ✓✓✓ | ✓✓ | ✓ |

---

## الأمان

### تدابير الأمان المطبقة

1. **contextIsolation**: مفعل - عزل عملية Renderer عن Main Process
2. **nodeIntegration**: معطل - لا يمكن للوصول إلى Node.js APIs مباشرة
3. **preload.js**: جسر آمن عبر `contextBridge`
4. **webSecurity**: مفعل - حماية XSS و Cross-Origin
5. **تقييد التنقل**: النافذة لا تفتح روابط خارجية (تفتح في المتصفح الافتراضي)

---

## الترخيص

© 2024 karim Team. All rights reserved.
