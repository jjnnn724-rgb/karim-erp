# ⚡ دليل البدء السريع - karim ERP

## البدء في 5 دقائق

### المتطلبات الأساسية
- Windows 10+ أو Linux
- Node.js 18+ ([تحميل](https://nodejs.org/))
- npm 8+ (يأتي مع Node.js)
- 2GB RAM كحد أدنى
- 500MB مساحة فارغة

---

## 🚀 التثبيت والتشغيل

### خطوة 1: تحضير المجلد
```bash
# انسخ أو استخرج المشروع
unzip karim-erp.zip
cd karim-erp
```

### خطوة 2: تثبيت التبعيات (3-5 دقائق)
```bash
npm install
# أو إذا حدثت مشاكل:
npm install --legacy-peer-deps
```

### خطوة 3: تشغيل التطبيق
```bash
# للتشغيل العادي:
npm start

# أو للتطوير (مع DevTools):
npm run electron:dev
```

### خطوة 4: الوصول
```
في المتصفح: http://localhost:5000
```

---

## 📱 الوصول من الهاتف

```bash
# احصل على عنوان IP:
npm run show-ip

# على الهاتف، افتح المتصفح واكتب:
http://<YOUR_IP>:5000
```

---

## 🧪 الاختبارات السريعة

```bash
# اختبار بسيط
npm run smoke

# اختبار شامل
npm test

# اختبار POS
npm run pos-sale
```

---

## 🆘 المشاكل الشائعة

| المشكلة | الحل |
|--------|------|
| Port 5000 مشغول | `PORT=5001 npm start` |
| خطأ تبعيات | `npm cache clean --force && npm install` |
| PostgreSQL لا يعمل | `npm run status` |

---

## 📚 المزيد من المعلومات

- 📄 [دليل الإصلاح الكامل](./FIX-AND-RUN-GUIDE.md)
- 📊 [تقرير الفحص](./PROJECT-AUDIT-REPORT.md)
- 🗺️ [خطة التطوير](./DEVELOPMENT-ROADMAP.md)
- 📖 [README الرئيسي](../README.md)

---

**جاهز للبدء؟ افتح Terminal/CMD وشغّل:** `npm install && npm start`
