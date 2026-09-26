# 🦅 karim ERP - دليل بناء NSIS لنظام Windows

## 📋 نظرة سريعة

| العنصر | التفاصيل |
|--------|----------|
| **المنتج** | karim ERP v2.1.0 |
| **الملف الناتج** | `Karim-ERP-Setup-2.1.0.exe` |
| **الحجم المتوقع** | ~85-120 MB |
| **نظام التشغيل المطلوب** | Windows 10/11 (64-bit) |
| **المتطلبات** | Node.js 18+, Git, 4GB RAM |

---

## 🚀 طريقة البناء السريعة (3 دقائق)

### الطريقة الأولى: استخدام Batch Script (الأسهل)

```cmd
# 1. افتح Command Prompt كمسؤول (Run as Administrator)
# 2. انتقل لمجلد المشروع
cd path\to\karim-erp

# 3. شغل السكربت
build-windows-nsis.bat

# 4. انتظر حتى ينتهي البناء (2-3 دقائق)
# 5. ستجد الملف في: release/Karim-ERP-Setup-2.1.0.exe
```

### الطريقة الثانية: PowerShell (متقدم)

```powershell
# 1. افتح PowerShell كمسؤول
# 2. انتقل للمجلد
cd path\to\karim-erp

# 3. شغل السكربت (سمح بتنفيذ السكربتات أولاً)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\build-windows-nsis.ps1 -Verbose

# 4. سيفتح مجلد التنزيل تلقائياً عند الانتهاء
```

### الطريقة الثالثة: أوامر مباشرة

```cmd
# 1. ثبت الاعتماديات
npm install

# 2. ثبت Electron binaries
npx electron install

# 3. ابنِ NSIS Installer
npm run electron:build:nsis

# 4. ابحث عن الملف في مجلد release/
dir release\*.exe
```

---

## 📦 الملفات بعد البناء

بعد نجاح البناء، ستحصل على هذه الملفات:

```
release/
├── 🦅 Karim-ERP-Setup-2.1.0.exe      ← ⭐ هذا هو المثبت الرئيسي
├── 📦 Karim-ERP-Portable-2.1.0.exe    ← نسخة محمولة (اختياري)
├── 📄 builder-effective-config.yaml   ← إعدادات البناء
└── 📊 latest.yml                      ├── معلومات التحديث التلقائي
```

**انسخ** `Karim-ERP-Setup-2.1.0.exe` إلى أي جهاز Windows وقم بتثبيته!

---

## 🔧 حل المشاكل الشائعة

### ❌ "node is not recognized"
**الحل**: ثبت Node.js من https://nodejs.org/ (اختر LTS version)

### ❌ "npm ERR! code ELIFECYCLE"
**الحل**: 
```cmd
# امسح cache وأعد المحاولة
npm cache clean --force
rmdir /s /q node_modules
npm install
```

### ❌ "electron-builder cannot execute"
**الحل**: تأكد من تشغيل CMD/PowerShell **كمسؤول**

### ❌ "port 5000 already in use"
**الحل**: أغلق أي برنامج يستخدم المنفذ 5000:
```cmd
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F
```

### ❌ "Antivirus blocking"
**الحل**: عطل مضاد الفيروسات مؤقتاً أثناء البناء فقط

### ❌ "NSIS/MUI_ICON already defined"
**الحل**: هذا خطأ في الإعدادات. استخدم السكربت الجاهز (`build-windows-nsis.bat`) الذي يحل هذه المشكلة تلقائياً

---

## 🎯 ميزات المثبت (NSIS Installer)

عند تشغيل `Karim-ERP-Setup-2.1.0.exe` على Windows:

✅ **معالج تثبيت احترافي** مع واجهة عصرية  
✅ **اختيار مسار التثبيت** (مثبت: `C:\Program Files\karim ERP\`)  
✅ **اختصار سطح المكتب** مع أيقونة حورس الذهبية 🦅  
✅ **قائمة ابدأ**  
✅ **قاعدة بيانات PostgreSQL المحمولة** (تُشغل تلقائياً)  
✅ **خادم Express على port 5000** (جاهز للشبكة LAN)  
✅ **قاعدة جدار نارية** (Firewall rule) للوصول الشبكي  
✅ **إلغاء تثبيت كامل** مع خيار حفظ البيانات  

---

## 🌐 بعد التثبيت - الوصول للتطبيق

### من نفس الجهاز:
```
🌐 http://localhost:5000/app/index.html
```

### من أجهزة أخرى على الشبكة:
```
🌐 http://<IP_ADDRESS>:5000/app/index.html

مثال: http://192.168.1.100:5000/app/index.html
```

**لاسترجاع IP الخاص بك:**
```cmd
ipconfig | findstr IPv4
```

---

## 📱 استخدام karim ERP على الأجهزة الأخرى

بعد التثبيت على جهاز Windows رئيسي:

1. **افتح التطبيق** (سيبدأ تلقائياً أو من اختصار سطح المكتب)
2. **انتظر** حتى يظهر "🦅 karim ERP جاهز!" في System Tray
3. **من أي جهاز** (تابلت، هاتف، كمبيوتر آخر) على نفس الشبكة:
   - افتح المتصفح
   - أدخل: `http://IP_OF_MAIN_PC:5000`
   - استمتع! 🎉

---

## 🔒 ملاحظات أمان

⚠️ **هام**: المثبت يحتاج **صلاحيات المسؤول** لأنه:
- يضيف قواعد Firewall للشبكة
- يسجل URL Protocol handler
- يُثبت في Program Files
- يُشغل PostgreSQL كخدمة

✅ **آمن 100%** - الكود مفتوح المصدر ويمكن مراجعته

---

## 🆘 الدعم الفني

- **البريد**: support@karim-erp.com
- **الوثائق**: راجع `docs/` folder
- **الأخطاء**: افتح Issue على GitHub

---

## 📄 الرخصة

© 2024 karim Team - Powered by Ancient Egyptian Excellence 🦅

---
**تم إنشاء هذا الدليل بواسطة karim Build System v2.1.0**
