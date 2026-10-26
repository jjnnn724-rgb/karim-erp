# توثيق واجهة برمجة التطبيقات (API Documentation)

يوفر خادم karim ERP API مجموعة من مسارات التواصل (Endpoints) للواجهة الأمامية لاسترجاع وحفظ البيانات. يتواصل الخادم ويرد بصيغة `JSON`.

## 1. نقاط النظام الرئيسية

### التحقق من صحة الخادم (Health)
* **المسار:** `GET /api/health`
* **الوصف:** التحقق من جاهزية الـ Backend واتصاله بقاعدة البيانات.
* **الرد الناجح (200 OK):**
```json
{
  "status": "ok",
  "time": "2026-07-15T14:00:00.000Z",
  "message": "Server and Database are healthy."
}
```

### جلب عنوان الشبكة (Network Info)
* **المسار:** `GET /api/network-info`
* **الوصف:** استرجاع جميع عناوين IP المتوفرة لتسهيل الاتصال.
* **الرد الناجح (200 OK):**
```json
{
  "ips": {
    "Wi-Fi": ["192.168.1.15"]
  },
  "port": 5000,
  "urls": ["http://192.168.1.15:5000/app/index.html"]
}
```

### مزامنة حالة التطبيق بالكامل (State Sync)
تُستخدم هاتين النقطتين حالياً لضمان توافق تطبيق HTML ذو الملف الواحد مع الشبكة، دون التعديل على منطق العمل الداخلي. يتم أخذ نسخة احتياطية من كائن `STATE` بكامله.

* **المسار:** `GET /api/state`
* **الوصف:** جلب نسخة `STATE` الكاملة.
* **الرد الناجح (200 OK):**
```json
{
  "users": [...],
  "departments": [...],
  "inventory": [...]
}
```

* **المسار:** `POST /api/state`
* **الوصف:** حفظ `STATE` الكامل (يجب أن يُرسل ككائن JSON في الـ Body). سيقوم هذا المسار تلقائياً بتشغيل سكربت النسخ الاحتياطي لقاعدة البيانات.
* **الرد الناجح (200 OK):**
```json
{
  "status": "success",
  "message": "State saved successfully and backup triggered."
}
```

---

## 2. نقاط الكيانات الفردية (Dynamic CRUD)
لتسهيل أي توسع مستقبلي وتحسين الأداء (عندما يتم إعادة برمجة الواجهة الأمامية)، يوفر الخادم نقاط CRUD ديناميكية لجميع الجداول.

**الكيانات المدعومة `[entity]`:**
`users`, `hrDepartments`, `employees`, `attendance`, `leaveTypes`, `leaveRequests`, `payroll`, `departments`, `revenues`, `expenses`, `shelves`, `inventory`, `inventoryTx`, `dispatches`, `recipes`, `purchaseInvoices`, `kitchenReturns`, `weightReadings`, `notifications`, `settings`.

### جلب جميع السجلات
* **المسار:** `GET /api/[entity]`
* **مثال:** `GET /api/inventory`
* **الرد (200 OK):**
```json
[
  { "id": "1698234812300", "name": "أرز بسمتي", "category": "حبوب" },
  { "id": "1698234812301", "name": "دجاج", "category": "لحوم" }
]
```

### جلب سجل محدد
* **المسار:** `GET /api/[entity]/:id`
* **الرد (200 OK):** `{"id": "1698234812300", "name": "أرز بسمتي"}`
* **في حال عدم وجوده (404 Not Found):** `{"error": "Not found"}`

### إضافة سجل جديد
* **المسار:** `POST /api/[entity]`
* **الـ Body:** كائن JSON يحتوي على الحقول.
* **الرد (201 Created):** يعيد الكائن المُضاف.

### تحديث سجل
* **المسار:** `PUT /api/[entity]/:id`
* **الـ Body:** الحقول المراد تحديثها فقط.
* **الرد (200 OK):** يعيد الكائن المُحدّث.

### حذف سجل
* **المسار:** `DELETE /api/[entity]/:id`
* **الرد (200 OK):** `{"message": "Deleted successfully"}`

## 3. قيود الخادم والسياسات
- أقصى حد لحجم الطلبات `JSON Payload` هو **50 ميجابايت** لاستيعاب كائن `STATE` كبير الحجم جداً بدون أخطاء.
- يتم السماح بـ **CORS** من كافة الأصول `origin: *` لتمكين الهواتف وأجهزة الشبكة من العمل بأريحية.
