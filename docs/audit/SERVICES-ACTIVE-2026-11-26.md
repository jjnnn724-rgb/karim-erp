# حالة الخدمات — 2026-11-26

الخدمات الثلاثة اتعاد توجيهها للمسار الجديد وشغّالة تلقائياً:

| الخدمة | المسار | الحالة | الإقلاع |
|---|---|---|---|
| KarimERP-Server | `KARIM-ERP\windows-service\KarimERP-Service.exe` | Running | Automatic |
| KarimERP-Control | `KARIM-ERP\windows-service\KarimERP-Control.exe` | Running | Automatic |
| KarimControlTunnel | `KARIM-ERP\windows-service\KarimControlTunnel.exe` | Running | Automatic |

## روابط النظام
- الرئيسية: `https://localhost:5000/app/index.html`
- v3: `https://localhost:5000/v3/`
- الشبكة: `https://192.168.1.165:5000/app/index.html`

## تحقق فعلي
- `/api/health/live` (بـ `x-api-key`) = 200
- `/app/index.html` = 200
- `/v3/` = 200
- المنفذ 5000 مستمع من عملية الخدمة (PID 34724 وقت الفحص)

السيرفر المؤقت (اللي كان شغال بالأمر `node scripts/serve.js`) اتوقف عشان الخدمة تاخد المنفذ. سيرفر v3 القديم على 5200 اتوقف كمان لأن v3 بقى مخدوم من `/v3/` على نفس الأصل.
