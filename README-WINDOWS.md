# 🪟 karim ERP v2.1.0 — Windows Scripts

> **5 سكربتات شاملة** لإدارة karim ERP على ويندوز بضغطة زر — بدون أي أوامر يدوية.

---

## 📁 الملفات

| الملف | الوصف | الاستخدام |
|------|------|----------|
| `Karim-ERP-Launcher.bat` | 🚀 **القاذفة التفاعلية** — قائمة بـ 9 خيارات | Double-click |
| `setup-windows.bat` | تثبيت كامل (npm + PG + .env) | `setup-windows.bat` |
| `run-windows.bat` | تشغيل النظام كاملاً | `run-windows.bat` |
| `test-windows.bat` | تشغيل الاختبارات | `test-windows.bat [jest\|smoke\|integration\|pos]` |
| `build-windows.bat` | بناء .exe (NSIS + Portable) | `build-windows.bat [nsis\|portable]` |
| `karim-master.ps1` | سكربت PowerShell موحد (10 أوامر) | `karim-master.ps1 <command>` |

---

## 🚀 أسرع طريقة (Double-Click)

```
1. فُك ضغط الحزمة
2. Double-click على Karim-ERP-Launcher.bat
3. اختر [1] Setup (أول مرة فقط)
4. اختر [2] Run (للتشغيل)
```

---

## 📋 الاستخدام التفصيلي

### 1️⃣ Setup (تثبيت أول مرة)

```cmd
setup-windows.bat
```

**ماذا يفعل:**
- ✅ يتحقق من Node.js + npm
- ✅ يثبّت اعتماديات npm (742 حزمة)
- ✅ ينزّل PostgreSQL Portable (Windows binaries)
- ✅ يطبّق patch-html (compatibility check)
- ✅ يُنشئ `.env` بأسرار عشوائية قوية (96 hex chars)
- ✅ يتحقق من syntax كل ملفات JS (48 ملف)

**الوقت المتوقع:** 2-3 دقائق

---

### 2️⃣ Run (تشغيل النظام)

```cmd
run-windows.bat
```

**ماذا يفعل:**
- ✅ يتأكد من وجود `.env` (يُنشئه لو ناقص)
- ✅ يشغّل PostgreSQL Portable في الخلفية
- ✅ يطبّق migrations لو قاعدة البيانات فاضية
- ✅ يشغّل خادم Express على port 5000
- ✅ يفتح المتصفح على https://localhost:5001
- ✅ عند `Ctrl+C`: إغلاق آمن لكل العمليات

**الوصول:**
- نفس الجهاز: https://localhost:5001/app/index.html
- من الشبكة LAN: https://<your-IP>:5001/app/index.html بعد تثبيت `Karim-Local-CA.crt` على الجهاز العميل

---

### 3️⃣ Test (الاختبارات)

```cmd
:: كل الاختبارات (396 فحص)
test-windows.bat

:: اختبار واحد فقط
test-windows.bat jest
test-windows.bat smoke
test-windows.bat integration
test-windows.bat pos
```

**النتيجة المتوقعة:**
```
============================================================
  Test Summary
============================================================
  Passed: 4
  Failed: 0

  All 4 test suites passed: 396/396 checks
  Status: PRODUCTION READY
============================================================
```

---

### 4️⃣ Build (بناء .exe)

```cmd
:: بناء النسختين (NSIS + Portable)
build-windows.bat

:: NSIS installer فقط
build-windows.bat nsis

:: Portable فقط
build-windows.bat portable
```

**المخرجات في `release/`:**
- `Karim-ERP-Setup-2.1.0.exe` — Official installer (NSIS)
- `Karim-ERP-Portable-2.1.0.exe` — Standalone portable

**متطلبات:** مساحة ~1 GB

---

### 5️⃣ PowerShell Master Script

سكربت موحد يقدم 10 أوامر:

```powershell
# تثبيت
powershell -ExecutionPolicy Bypass -File karim-master.ps1 setup

# تشغيل
powershell -ExecutionPolicy Bypass -File karim-master.ps1 run

# اختبارات
powershell -ExecutionPolicy Bypass -File karim-master.ps1 test
powershell -ExecutionPolicy Bypass -File karim-master.ps1 test pos

# بناء
powershell -ExecutionPolicy Bypass -File karim-master.ps1 build nsis

# فحص الحالة
powershell -ExecutionPolicy Bypass -File karim-master.ps1 status

# إيقاف
powershell -ExecutionPolicy Bypass -File karim-master.ps1 stop

# تنظيف
powershell -ExecutionPolicy Bypass -File karim-master.ps1 clean

# إعادة تهيئة DB
powershell -ExecutionPolicy Bypass -File karim-master.ps1 reset-db

# نسخة احتياطية
powershell -ExecutionPolicy Bypass -File karim-master.ps1 backup

# استعادة نسخة
powershell -ExecutionPolicy Bypass -File karim-master.ps1 restore database/backups/mybackup.sql

# setup + run
powershell -ExecutionPolicy Bypass -File karim-master.ps1 all

# مساعدة
powershell -ExecutionPolicy Bypass -File karim-master.ps1 help
```

---

## 🎯 سيناريوهات شائعة

### سيناريو 1: أول تثبيت

```cmd
:: 1. فُك الضغط
:: 2. افتح CMD في مجلد المشروع
setup-windows.bat
:: 3. بعد الانتهاء
run-windows.bat
```

### سيناريو 2: تطوير + اختبار

```cmd
:: شغّل النظام في نافذة
run-windows.bat

:: في نافذة تانية، شغّل الاختبارات
test-windows.bat
```

### سيناريو 3: بناء للنشر

```cmd
:: 1. تأكد أن كل شيء شغال
test-windows.bat

:: 2. ابنِ الـ .exe
build-windows.bat

:: 3. ستجد الملفات في release/
::    - Karim-ERP-Setup-2.1.0.exe  (للنشر الرسمي)
::    - Karim-ERP-Portable-2.1.0.exe (نسخة محمولة)
```

### سيناريو 4: نسخة احتياطية قبل صيانة

```cmd
:: 1. خذ نسخة احتياطية
powershell -ExecutionPolicy Bypass -File karim-master.ps1 backup

:: 2. اوقف النظام
powershell -ExecutionPolicy Bypass -File karim-master.ps1 stop

:: 3. أعد التهيئة لو محتاج
powershell -ExecutionPolicy Bypass -File karim-master.ps1 reset-db

:: 4. شغّل من جديد
powershell -ExecutionPolicy Bypass -File karim-master.ps1 run
```

---

## 🔧 حل المشاكل

### المشكلة: "Node.js is not installed"
**الحل:** ثبّت Node.js 20+ من https://nodejs.org/ ثم أعد التشغيل.

### المشكلة: "Port 5000 already in use"
**الحل:**
```cmd
:: ابحث عن العملية
netstat -ano | findstr :5000

:: اقتلها (استبدل PID)
taskkill /PID <PID> /F

:: أو استخدم karim-master
powershell -ExecutionPolicy Bypass -File karim-master.ps1 stop
```

### المشكلة: "PostgreSQL won't start"
**الحل:**
```cmd
:: 1. تأكد إن port 5432 مش مستخدم
netstat -ano | findstr :5432

:: 2. لو مستخدم، اقتل العملية
taskkill /PID <PID> /F

:: 3. أعد التشغيل
run-windows.bat
```

### المشكلة: "Build failed"
**الحل:**
```cmd
:: 1. تأكد إن npm install اشتغل
setup-windows.bat

:: 2. امسح cache
npm cache clean --force

:: 3. اعد التثبيت
rmdir /s /q node_modules
npm install

:: 4. أعد البناء
build-windows.bat
```

### المشكلة: الـ .exe الناتج كبير جداً
**السبب:** PostgreSQL Portable (~100MB) مُضمَّن في الـ installer.
**الحل:** هذا متعمد — يضمن عمل النظام بدون تثبيت PostgreSQL خارجي.

---

## 📊 جدول الأوامر السريع

| المهمة | الأمر |
|------|------|
| تثبيت أول مرة | `setup-windows.bat` |
| تشغيل النظام | `run-windows.bat` |
| كل الاختبارات | `test-windows.bat` |
| اختبار POS فقط | `test-windows.bat pos` |
| بناء .exe | `build-windows.bat` |
| بناء NSIS فقط | `build-windows.bat nsis` |
| فحص الحالة | `karim-master.ps1 status` |
| إيقاف كل شيء | `karim-master.ps1 stop` |
| نسخة احتياطية | `karim-master.ps1 backup` |
| إعادة تهيئة DB | `karim-master.ps1 reset-db` |
| تنظيف كامل | `karim-master.ps1 clean` |
| مساعدة | `karim-master.ps1 help` |
| القاذفة التفاعلية | Double-click `Karim-ERP-Launcher.bat` |

---

## ⚡ نصائح للأداء

1. **استخدم SSD** — PostgreSQL أسرع بـ 10x على SSD
2. **أغلق البرامج الثقيلة** أثناء البناء (يستهلك ~2GB RAM)
3. **استخدم Node.js 20 LTS** للأداء الأفضل
4. **فعّل Windows Defender exclusion** لمجلد المشروع (تسريع npm install)

---

## 🔐 الأمان

- ✅ الـ `.env` يُنشأ بأسرار عشوائية (96 hex chars)
- ✅ JWT secrets تُولَّد بـ `crypto.randomBytes(48)`
- ✅ كلمات المرور تُحوَّل تلقائياً إلى bcrypt بعد أول login
- ✅ Database pool محمي بـ `statement_timeout: 15s`

**⚠️ مهم:** غيّر كلمات المرور الافتراضية (admin/1234) من صفحة الإعدادات بعد أول login!

---

## 📞 الدعم

- **البريد:** support@karim-erp.com
- **الوثائق:** راجع مجلد `docs/`
- **الاختبارات:** `test-windows.bat` للتحقق السريع

---

**© 2026 karim Team — Powered by Ancient Egyptian Excellence 🦅**
