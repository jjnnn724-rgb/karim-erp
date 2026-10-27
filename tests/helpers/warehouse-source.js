/**
 * warehouse-source.js — مصدر واحد لكود المخزن بعد تفكيك warehouse-routes.js
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا هذا المُساعد بدل `fs.readFileSync(.../warehouse-routes.js)`:
 *   قبل التفكيك كان الملف واحدًا (3792 سطرًا) و21 اختبارًا تقرأه نصًا وتُطابقه
 *   بـregex وبـ`slice(indexOf(a), indexOf(b))`. بعد التفكيك صار ستة ملفات، لكن
 *   **عقد المحتوى لم يتغيّر**: النص نفسه بالترتيب نفسه بالبايت نفسه (بما فيه
 *   CRLF والسطور الاثني عشر LF الخام). المُساعد يُعيد الدمج بالترتيب الأصلي —
 *   ثمّة فقط — فتبقى كل الإدعاءات تُقرأ كما كانت، ولا يُخفَّف أي اختبار.
 *
 * الانضباط: الوحدات تُدمج **بحسب ترتيب التسجيل على Express** (B←C←D←E←F)،
 * لأن ترتيب المطابقة في Express جزء من معنى المسارات.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** ترتيب أصلاي التسجيل على الـrouter — تغييره يغيّر معنى بعض المسارات. */
const PARTS = [
    'warehouse-routes.js',
    'warehouse/dispatch-routes.js',
    'warehouse/returns-routes.js',
    'warehouse/inventory-routes.js',
    'warehouse/purchase-void-routes.js',
    'warehouse/pr-routes.js',
];

let cached = null;

/**
 * نص كل وحدات المخزن مدموجًا بالترتيب الأصلي.
 * يُخزَّن مؤقتًا: الاختبارات تطلبه عشرات المرات ولا داعي لقراءته كل مرة.
 * @returns {string}
 */
function warehouseSource() {
    if (cached === null) {
        cached = PARTS
            .map((p) => fs.readFileSync(path.join(ROOT, 'backend', p), 'utf8'))
            .join('');
    }
    return cached;
}

/** للإبلاغ عن تقدّم الفحص: أي جزء ناقص يظهر بمساره لا بخطأ مبهم. */
function missingParts() {
    return PARTS.filter((p) => !fs.existsSync(path.join(ROOT, 'backend', p)));
}

module.exports = { warehouseSource, missingParts, PARTS, ROOT };