# RUNBOOK — karimeg.online / Karim-ERP Production

آخر تحديث: 2026-11-14 · الإصدار 1.0 · يتعامل فقط مع ما هو موجود فعلًا على الفرع الحالي

> هذا الكتاب **مرجع عملي** بمبدأ «اعمل كذا عند حدوث كذا». كل أمر هنا قابل للتنفيذ على الجهاز الإنتاجي `DESKTOP-8EMUPJ5`. قسم 0 قاعدة: إن لم تكن المالك التقني للموقع فلا تنفذ ما في هذا الكتاب — اتصل به.

---

## 0. القاعدة الذهبية

**لا تعدّل أي بيانات حيّة، ولا تستعيد نسخة، ولا تُفعّل الزاتكا، إلا بقرارك أنت كمالك.**
استعادة قاعدة بيانات حيّة بلا تفويض هي الطريقة الوحيدة لأن تُفقد الفواتير الحقيقية للمطعم.

---

## 1. الفحص السريع — 30 ثانية

```powershell
# على جهاز المطعم
curl.exe -s -o $null -w "%{http_code}" http://127.0.0.1:5001/api/health
# المتوقع: 200

# من أي مكان
curl.exe -s -o $null -w "%{http_code}" https://karimeg.online/api/health
# المتوقع: 200
```

---

## 2. المراقبة

### 2.1 قراءة حالة الخدمة

```powershell
Get-Service KarimERP-Server
Get-Service postgresql-x64-18
```

| النتيجة | المعنى |
|---|---|
| كل منهما `Running` | الموقع حي |
| `KarimERP-Server` متوقف | الخدمة ماتت — انظر 2.3 |
| `postgresql-x64-18` متوقف | قاعدة البيانات معطلة |
| `KarimERP-Server` + `Manual` | توقّف متعمد |

### 2.2 حارس الصحة (Watchdog)

```powershell
node scripts/watchdog-health.mjs            # فحص واحد وسجلّ في logs/watchdog-YYYY-MM-DD.log
```

السطر الحقيقي الناتج:

```
✓ UP status=200 version=4.9.2 uptime=0d 0h 29m comps=[memory:ok,…]
```

**التسجيل كجدولة Windows (مرة واحدة):**

```powershell
.\scripts\install-watchdog.ps1
```

يفحص كل 60 ثانية. عند 3 فشل متتالٍ يرسل HTTP POST إلى `WATCHDOG_WEBHOOK` (متغيّر البيئة). بلا WEBHOOK يسجل فقط في `logs/watchdog-*.log`.

### 2.3 الرد عند DOWN

```powershell
# 1) تحقق أن العملية حيّة فعلًا
Get-Process node -ErrorAction SilentlyContinue

# 2) أعد تشغيل الخدمة
Restart-Service KarimERP-Server
Start-Sleep -Seconds 5

# 3) الفحص
curl.exe -s -o $null -w "%{http_code}" http://127.0.0.1:5001/api/health
# إن 200 → عاد يعمل
```

إذا لم يعد:

```powershell
Get-Content logs\app-out.log -Tail 80
```

ابحث عن آخر سطر يحمل كلمة `error` أو `FATAL`. إن وجدت أخطاء اتصال قاعدة بيانات:

```powershell
Restart-Service postgresql-x64-18
Start-Sleep -Seconds 10
curl.exe -s -o $null -w "%{http_code}" http://127.0.0.1:5001/api/health
```

---

## 3. نشر التغييرات

الفرع الوحيد: `release/prod-sync-2026-11-12` — نشره **يدوي وعمدًا** (لا CD).

```powershell
# 1) التحقق من التغييرات
git status --short ; git log --oneline -3

# 2) التحقق من الاختبارات
$env:DB_NAME='karim_erp_test'; $env:KARIM_TEST_DB_NAME='karim_erp_test'; $env:KARIM_TEST_DB_ISOLATED='1'
npx jest --silent

# 3) البناء والنشر
cd v3 && pnpm --filter @karim/web build ; cd ..
node v3/scripts/sync-build.mjs     # يعيد نسخ v3/apps/web/dist → frontend/v3 + تأكيد 200

# 4) تأكيد
curl.exe -I http://127.0.0.1:5001/app/ /v3/ ; curl.exe -s -o $null -w "%{http_code}`n" http://127.0.0.1:5001/api/health
```

تغييرات الباك-إند (backend/cashier-module) تتطلب:

```powershell
Restart-Service KarimERP-Server
```

---

## 4. الطابعة وفتح الوردية

### 4.1 طابعة POSIFLEX PRG-9000

لا تُكتشف الطابعات وحدها. التسجيل مرة واحدة:

```powershell
curl.exe -X POST http://127.0.0.1:5001/api/pos/printer `
  -H "Authorization: Bearer <admin-token>" `
  -H "content-type: application/json" `
  -d '{"name":"Kitchen","connection_type":"network","address":"192.168.1.50:9100","paper_width_mm":58}'
```

```powershell
# الرد إن الطابعة غير مسجلة: 404 أو 422
curl.exe http://127.0.0.1:5001/api/pos/printer -H "Authorization: Bearer <admin-token>"
```

### 4.2 فتح الوردية

```powershell
curl.exe -X POST http://127.0.0.1:5001/api/pos/shift/open `
  -H "Authorization: Bearer <admin-token>" `
  -H "content-type: application/json" `
  -d "{\"departmentId\": 1}"
```

| الخطأ | المعنى |
|---|---|
| `SHIFT_ALREADY_OPEN` | وردية الأمس ما زالت مفتوحة |
| `PERMISSION_DENIED` | ليس admin/manager |
| `PERIOD_CLOSED` | فترة اليوم مقفلة |
| `DEPT_NOT_FOUND` | القسم غير معروف |

```powershell
# الوردية مفتوحة ولا تُغلق
curl.exe -X POST http://127.0.0.1:5001/api/pos/shift/close -H "Authorization: Bearer <admin-token>" -H "content-type: application/json" -d "{\"sessionId\": <id>}"
```

---

## 5. أخطاء الفوترة

`INVOICE_UNBALANCED`

المجموع قبل الضريبة ≠ الإجمالي النهائي. **البيع يُرفض — لا يوجد فاتورة شبه فوترة.**
ابحث في القاعدة عن سبب الإخلال:

```powershell
psql.exe -U karim_app -h 127.0.0.1 -d karim_erp -c "SELECT count(*) FROM pos_orders WHERE status='issued' AND round(subtotal + tax_total,2) <> round(total_amount,2);"
```

إن كان أي صفوف ظهرت، فهو ما قبل الإصلاح. أبلغ المطور — لا تصحح بإصلاح يدوي.

---

## 6. الواجهات

إذا لم تفتح `/app/` أو `/v3/pos-entry`:

```powershell
curl.exe -I http://127.0.0.1:5001/app/
curl.exe -I http://127.0.0.1:5001/v3/pos-entry
```

إن 200 → المشكلة في المتصفح: `Ctrl + F5`.

إن لم تُقلع بعد `Ctrl + F5`: راجع `logs/app-out.log` — أو أبلغ المطور مع نص الخطأ.

---

## 7. الاستعادة

**قبل أي خطوة:** `npm run backup` ثم `node scripts/verify-backup.mjs` —

```
✓ kbak-integrity: sha256 matches (…bytes)
✓ pg_dump-creatable: 233 CREATE TABLE · 233 COPY · … bytes in …ms
```

### 7.1 التراجع (rollback) — البدائل الأسرع

```powershell
.\scripts\rollback.ps1 -Latest
```

يتأكد من صلاحية النسخة، يستبدل `frontend/v3/` بنسخة احتياطية من `backups/`، يعيد تشغيل الخدمة، ويقيس `/api/health`.

### 7.2 استعادة قاعدة البيانات — بعد موافقة المالك

```powershell
# 1) قبل أي شيء: نسخة
npm run backup

# 2) الاستعادة على قاعدة scratch فقط (وليس karim_erp الحيّة)
node scripts/restore.js restore <ملف-decrypted.sql>
```

ملاحظة: `restore.js` محكوم بكلمة passphrase لـلنسخة `.kbak`، ويعيد تشفيرها قبل العمل. بدونها لا يمكن فكّ أي نسخة.

---

## 8. الزاتكا

الحالي: `enabled=false` — الربط مقفول، البيع مستمر بلا إرسال.

**الشروط لتفعيل ZATCA:**

1. seller_name في `zatca_settings` = الاسم المسجل الرسمي للمنشأة
2. vat_number = الرقم الضريبي الفعلي
3. crn = السجل التجاري
4. address = العنوان الوطني
5. branch_name = اسم الفرع
6. `private_key_pem` = المفتاح الخاص من بوابة fatoora.zatca.gov.sa
7. `ZATCA_ENABLED=true` في `.env`

**بعد التفعيل:**

```powershell
psql.exe -U karim_app -h 127.0.0.1 -d karim_erp -c "SELECT status, count(*) FROM pos_zatca_invoice_queue GROUP BY status;"
```

الـ6 فواتير المعلقة (قبل التفعيل): لن تُرسل تلقائيًا. القرار بيد المالك: توثيقها تاريخيًا أو حذفها من الطابور.

---

## 9. ما يفعّل 9/10 فعليًا (المتبقي)

- ZATCA Phase-2 مُفعّل + 3 فواتير حقيقية مُرسَلة بدلة /تم التحقق/ (قسم 8)
- Restore ممارس مرّة واحدة على scratch حقيقي مع correct passphrase + scripts/restore.js (قسم 7)
- Watchdog سجلته صراحة في Task Scheduler وأعطاه وقت deal حتى التقط الـdown المزيّف
- CI مزروعة على الفرع الرئيسي وتنجح فيه (`.github/workflows/ci.yml`)

