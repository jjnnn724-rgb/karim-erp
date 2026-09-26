# سجل التغييرات (Changelog)

**الإصدار:** `v11.0.0 - LAN Edition`

تم في هذا الإصدار تحويل نظام `karim ERP Premium v10-4` من كونه ملف HTML يعتمد بالكامل على تخزين المتصفح المحلي (LocalStorage / IndexedDB)، إلى نظام Client-Server متكامل يعمل على شبكة المطعم/الفندق بأمان ومركزية تامة باستخدام Node.js و PostgreSQL.

## التغييرات التي طرأت على الكود المصدري الأصلي
لضمان عدم حدوث أي تكسر في الواجهة وعدم تغيير أي ميزة موجودة، تم تحديد التغييرات داخل ملف `4Global_View_Premium_v10-4.html` لتكون بأقل قدر ممكن عبر سكربت `scripts/patch-html.js`. 

### 1. إضافة متغير الشبكة الديناميكي
تمت إضافة المتغير التالي بعد تعريف `const STATE = {...};` مباشرة:
```javascript
// استبدال API للشبكة المحلية
const API_BASE = window.location.origin + '/api';
```

### 2. استبدال دالة `initDatabase()`
الكود قبل التعديل:
كانت تقوم بإعداد IndexedDB أو LocalStorage وطلب صلاحيات التخزين.

الكود بعد التعديل:
```javascript
async function initDatabase() {
    try {
        const response = await fetch(API_BASE + '/health');
        if (response.ok) {
            console.log('Backend connected successfully');
            return true;
        }
        throw new Error('Backend not healthy');
    } catch (e) {
        console.warn('Backend connection failed, using localStorage as fallback', e);
        if(!localStorage.getItem('global_view_data')){
            localStorage.setItem('global_view_data', JSON.stringify(STATE));
        }
        return true;
    }
}
```

### 3. استبدال دالة `loadData()`
الكود قبل التعديل:
كان يقرأ من `localStorage.getItem('global_view_data')` ويُسندها لكائن STATE.

الكود بعد التعديل:
```javascript
async function loadData() {
    try {
        const response = await fetch(API_BASE + '/state');
        if (response.ok) {
            const data = await response.json();
            Object.assign(STATE, data);
            localStorage.setItem('global_view_data', JSON.stringify(STATE));
            if(window.toast) toast('تم تحميل البيانات من الخادم', 'success');
            return;
        }
        throw new Error('Failed to load state from backend');
    } catch (e) {
        console.warn('Backend load failed, loading from localStorage', e);
        const localData = localStorage.getItem('global_view_data');
        if (localData) {
            Object.assign(STATE, JSON.parse(localData));
            if(window.toast) toast('تم تحميل البيانات محلياً (وضع عدم الاتصال)', 'warning');
        }
    }
}
```

### 4. استبدال دالة `saveData()`
الكود قبل التعديل:
كان يكتفي بالقيام بعملية `localStorage.setItem`.

الكود بعد التعديل:
```javascript
async function saveData() {
    const stateStr = JSON.stringify(STATE);
    try {
        const response = await fetch(API_BASE + '/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: stateStr
        });
        
        if (response.ok) {
            localStorage.setItem('global_view_data', stateStr); // Backup locally
            return;
        }
        throw new Error('Failed to save to backend');
    } catch (e) {
        console.warn('Backend save failed, saving to localStorage', e);
        localStorage.setItem('global_view_data', stateStr);
        if(window.toast) toast('تم الحفظ محلياً فقط (تأكد من اتصال الخادم)', 'warning');
    }
}
```

## تحديث: تقسيم واجهة المستخدم إلى ملفات منفصلة (Frontend Split)
تم استبدال ملف `frontend/app/4Global_View_Premium_v10-4.html` الضخم (6591 سطر بترميز واحد) بثلاثة ملفات منظمة احترافياً داخل `frontend/app/`:
- `index.html` — هيكل الصفحة فقط (145 سطر)
- `css/styles.css` — كل التنسيقات (1509 سطر)
- `js/app.js` — كل منطق التطبيق (4376 سطر)

**تم فحص المحتوى بالكامل مقارنة بالنسخة الأصلية (diff) والتأكد من تطابق 100% من الوظائف**، مع إصلاح 3 أخطاء كانت موجودة في النسخة المُقسّمة قبل الدمج:
1. وسم `<script>` نصي زائد في بداية `js/app.js` كان يكسر الملف بالكامل (SyntaxError) ويمنع تحميل التطبيق.
2. وسم `<style>` نصي زائد في بداية `css/styles.css` كان يُبطل أول قاعدة CSS (`* { margin:0;padding:0;box-sizing:border-box }`).
3. سطر `<script src="qrcode.min.js">` كان ناقصاً من `index.html`، مما يعطّل توليد رموز QR لبطاقات الموظفين.

كما تم تحديث كل الإشارات إلى اسم الملف القديم (`4Global_View_Premium_v10-4.html`) في `backend/server.js`، `scripts/start.js`، `scripts/show-ip.js`، `docs/API.md`، و`docs/DEPLOYMENT.md` لتشير إلى `/app/index.html` الجديد. نسخة `frontend/legacy/` (localStorage بدون خادم) تُركت كما هي دون تغيير كمرجع.

## التغييرات في معمارية المشروع
- **إضافة سيرفر Node.js**: يعمل ببرمجية `Express.js` كخادم API لربط الواجهة بقاعدة البيانات.
- **إضافة PostgreSQL المحمول**: لا يعتمد على تثبيت أي برنامج في الجهاز، وهو قادر على تلقي البيانات بشكل فوري.
- **إضافة سكربتات النسخ الاحتياطي التلقائي**: تعمل عند كل تعديل.
- **دعم اتصالات متعددة**: يمكن للكاشير، المطبخ، والمخزن التحديث من أجهزة مختلفة، وستنعكس البيانات.
