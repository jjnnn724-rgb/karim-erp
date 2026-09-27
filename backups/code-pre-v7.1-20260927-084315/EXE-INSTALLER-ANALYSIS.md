# 📦 تحليل احترافي لمثبتات Windows EXE — karim ERP v4.7.0

**التاريخ:** 19 سبتمبر 2026  
**الحالة:** جاهز للتحسين — البنية موجودة، تحتاج تعزيز لمعايير الجودة العالمية

---

## 🎯 ملخص تنفيذي

| المكون | الحالة الحالية | المطلوب للمستوى الاحترافي |
|----------|----------------|---------------------------|
| **electron-builder NSIS** | ⚠️ أساسي — يعمل لكن ناقص | ✅ محسن بالكامل |
| **Portable EXE** | ⚠️ أساسي — يعمل لكن ناقص | ✅ محسن بالكامل |
| **Inno Setup (بديل)** | ⚠️ مولد آلي — ناقص الخدمات | ✅ بديل قوي |
| **تثبيت الخدمات** | ❌ مسارات مبرمجة (hardcoded) | ✅ مسارات ديناميكية |
| **توقيع الكود (Code Signing)** | ❌ معطل | ✅ مفعل مع شهادة |
| **التحديث التلقائي** | ❌ غير معد | ✅ مُعد للإنتاج |
| **التحقق من التكامل** | ⚠️ جزئي | ✅ شامل (SHA256 + تحقق) |
| **تجربة المستخدم** | ⚠️ أساسية | ✅ احترافية (UI/UX) |

---

## 🔍 التحليل المفصل

### 1. إعدادات electron-builder الحالية (`package.json`)

**✅ نقاط القوة:**
- NSIS + Portable targets محددة
- `perMachine: true` — تثبيت لكل الجهاز
- `allowToChangeInstallationDirectory: true`
- `runAfterFinish: true` — تشغيل بعد التثبيت
- `asar: true` — حماية الكود
- `asarUnpack` للثنائيات الضرورية

**❌ نقاط الضعف الحرجة:**

```json
// الحالي - ناقص:
"verifyUpdateCodeSignature": false,
"signAndEditExecutable": false,
"rfc3161TimeStampServer": "",
// لا يوجد: signingConfig, publish, electronUpdaterCompatibility
```

### 2. مثبت NSIS المخصص (`build/installer.nsh`)

**المشاكل:**
- يعتمد على `AlShorfaERPService.exe` — لكن الملفات في `windows-service/` لها مسارات **مبرمجة للجهاز التطويري**
- لا يتعامل مع PostgreSQL service
- لا يوجد تحقق من المتطلبات المسبقة (VC++ Redist, Node.js)
- لا يوجد صفحة ترخيص مخصصة بالعربية
- لا يوجد خيار "إصلاح" أو "تعديل" التثبيت

### 3. خدمة Windows (`windows-service/`)

**مشكلة حرجة:** ملفات XML تحتوي على مسارات مطلقة للجهاز التطويري:
```xml
<executable>C:\Users\karim\AppData\Local\hermes\node\node.exe</executable>
<workingdirectory>C:\Users\karim\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp</workingdirectory>
<logpath>C:\Users\karim\Desktop\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp\logs</logpath>
```
**هذه لن تعمل على أجهزة العملاء!**

### 4. Inno Setup Script (`dist/installer/AlShorfa-ERP-Setup.iss`)

**الناقص:**
- لا يثبّت PostgreSQL كخدمة
- لا يثبّت خدمات التطبيق (Server + Print Worker)
- لا يضبط جدار الحماية
- لا ينشئ مهمة النسخ الاحتياطي اليومية
- لا يتحقق من VC++ Redistributable
- لغة واحدة فقط (English)

---

## 🛠️ خطة التحسينات المطلوبة

### المرحلة 1: إصلاح خدمات Windows (حرج — قبل أي بناء)

#### 1.1 قوالب XML ديناميكية
إنشاء قوالب تُملأ وقت التثبيت بمتغيرات `{app}` و `{localappdata}`.

#### 1.2 سكريبت تثبيت خدمات موحد
يحل محل `install-service.bat` الحالي ويعمل من داخل المثبت.

### المرحلة 2: تحسين electron-builder NSIS

#### 2.1 إعدادات التوقيع والنشر
```json
"build": {
  "win": {
    "signAndEditExecutable": true,
    "verifyUpdateCodeSignature": true,
    "rfc3161TimeStampServer": "http://timestamp.digicert.com",
    "certificateFile": "build/cert.p12",
    "certificatePassword": "${CERT_PASSWORD}"
  },
  "publish": {
    "provider": "github",
    "owner": "karim-erp",
    "repo": "karim-desktop"
  }
}
```

#### 2.2 NSIS مخصص متقدم (`build/installer.nsh` محسن)
- صفحة ترخيص RTL عربية
- فحص VC++ Redist وتثبيته تلقائياً
- تثبيت PostgreSQL كخدمة
- تثبيت خدمات التطبيق
- ضبط جدار الحماية
- مهمة النسخ الاحتياطي
- خيار "إصلاح" في قائمة ابدأ

### المرحلة 3: Portable EXE احترافي

- `electron-builder` Portable مع:
  - Self-contained (لا يحتاج Node.js منفصل)
  - PostgreSQL مدمج يعمل من المجلد
  - إعدادات في `%APPDATA%\KarimERP` وليس بجانب الـ EXE
  - تحديث تلقائي عبر GitHub Releases

### المرحلة 4: Code Signing + Auto-Update

- شهادة EV Code Signing (مطلوبة لـ SmartScreen)
- GitHub Releases كناشر تحديثات
- `electron-updater` مدمج في التطبيق

---

## 📋 قائمة المهام الفورية (قابلة للتنفيذ الآن)

### ✅ يمكن تنفيذها فوراً بدون شهادة:

1. **[ ] إصلاح مسارات خدمات Windows** — قوالب XML ديناميكية
2. **[ ] NSIS مخصص كامل** — مع تثبيت خدمات + PostgreSQL + Firewall + Backup
3. **[ ] تحسين Portable** — self-contained مع إعدادات منفصلة
4. **[ ] التحقق من التكامل** — SHA256 مدمج في المثبت
5. **[ ] تجربة مستخدم عربية** — RTL، ترخيص، رسائل واضحة

### 🔒 تتطلب شهادة Code Signing (لاحقاً):

6. **[ ] تفعيل التوقيع** — `signAndEditExecutable: true`
7. **[ ] إعداد النشر التلقائي** — GitHub Actions → Releases
8. **[ ] electron-updater** — فحص التحديثات عند البدء

---

## 🏗️ الملفات التي تحتاج تعديل/إنشاء

| الملف | الإجراء | الأولوية |
|--------|---------|----------|
| `package.json` | تحسين `build.win` + `build.nsis` + `build.publish` | 🔴 حرجة |
| `build/installer.nsh` | إعادة كتابة كاملة — NSIS متقدم | 🔴 حرجة |
| `windows-service/*.xml` | تحويل لقوالب `.nsh` تُملأ وقت التثبيت | 🔴 حرجة |
| `windows-service/install-service.nsh` | جديد — سكريبت تثبيت خدمات NSIS | 🔴 حرجة |
| `build/portable-config.js` | جديد — إعدادات Portable مخصصة | 🟡 عالية |
| `electron/main.js` | دمج `electron-updater` + auto-update | 🟡 عالية |
| `scripts/migrate.js` | إضافة `--sign` flag للبناء الموقع | 🟢 متوسطة |

---

## 💡 توصيات إضافية للجودة العالمية

1. **GitHub Actions CI/CD** — بناء وتوقيع ونشر تلقائي عند tag
2. **إختبار على Windows نظيفة** — VM بدون أدوات تطوير
3. **فحص VirusTotal** — لكل إصدار قبل النشر
4. **توثيق المستخدم النهائي** — دليل تثبيت مصور بالعربية
5. **Telemetry مجهول** — إحصائيات استخدام (اختياري، GDPR compliant)

---

## 🚀 الخطوة التالية المقترحة

**هل تريد أن أبدأ بتنفيذ المرحلة 1 (إصلاح الخدمات) والمرحلة 2 (NSIS محسن) الآن؟**
سأقوم بـ:
1. إنشاء قوالب خدمات ديناميكية
2. إعادة كتابة `build/installer.nsh` بالكامل
3. تحديث `package.json` بأفضل الممارسات
4. اختبار البناء محلياً

**رد بـ "كمل" للمتابعة، أو حدد مرحلة محددة.**