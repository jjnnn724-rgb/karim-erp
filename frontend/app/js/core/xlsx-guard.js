/**
 * xlsx-guard.js — حراسة قراءة ملفات Excel في المتصفح
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا: قراءة XLSX تجلب الملف كله إلى الذاكرة وتحوّله لكائنات.
 * ملف ضخم (مئات الميغابايت) يُجمّد المتصفح ويُنهي جلسة الكاشير،
 * وملف مُحضَّر يضغط على المُحلِّل. الحدّان يمنعان ذلك قبل القراءة.
 *
 * الحد الافتراضي: 20MB و20,000 صف — سخيّ لمreadsheet المستودع.
 * النسخة المُضمّنة من SheetJS (1.15.0) مُصلَحة من ثغرات prototype
 * pollution وReDoS؛ هذه الحراسة تكمّلها بحدود الموارد.
 *
 * UMD: تعمل في السكربتات العادية (window.XLSXGuard) وفي الوحدات (import).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {module.exports = api;}
    else {root.XLSXGuard = api;}
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_BYTES = 20 * 1024 * 1024;   // 20MB
    const MAX_ROWS = 20000;

    /** خطأ مخصّص برسالة عربية جاهزة للعرض. */
    class ExcelGuardError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ExcelGuardError';
        }
    }

    /**
     * يتحقق من حجم الملف قبل قراءته.
     * @param {{size?: number, name?: string}} file
     */
    function assertFileSize(file) {
        if (!file || typeof file.size !== 'number') {return true;}
        if (file.size > MAX_BYTES) {
            throw new ExcelGuardError(
                `حجم الملف يتجاوز الحد المسموح (${Math.round(MAX_BYTES / 1024 / 1024)}MB) — اختر ملفًا أصغر`
            );
        }
        return true;
    }

    /**
     * يقرأ مصنَّفًا مع الحراسة: حجم + عدد صفوف.
     * @param {ArrayBuffer|Uint8Array|string} data
     * @param {{type?: string, maxRows?: number}} [opts]
     * @param {object} [xlsx] نسخة XLSX (لاختبارات بدون متصفح)
     */
    function readWorkbook(data, opts = {}, xlsx) {
        const lib = xlsx || (typeof window !== 'undefined' ? window.XLSX : null);
        if (!lib || typeof lib.read !== 'function') {
            throw new ExcelGuardError('مكتبة Excel غير محمّلة');
        }
        const type = opts.type || 'array';
        // حجم البيانات نفسها (قد يكون ArrayBuffer أو نصًا)
        const size = typeof data === 'string'
            ? data.length
            : (data && typeof data.byteLength === 'number' ? data.byteLength : (data && data.length) || 0);
        if (size > MAX_BYTES) {
            throw new ExcelGuardError(
                `حجم البيانات يتجاوز الحد المسموح (${Math.round(MAX_BYTES / 1024 / 1024)}MB)`
            );
        }
        const wb = lib.read(data, { type });
        const maxRows = Number(opts.maxRows || MAX_ROWS);
        const sheetName = wb && wb.SheetNames && wb.SheetNames[0];
        const sheet = sheetName ? wb.Sheets[sheetName] : null;
        if (sheet && sheet['!ref']) {
            const range = String(sheet['!ref']);
            const end = range.split(':').pop();
            const rowNum = parseInt(String(end).replace(/[^0-9]/g, ''), 10);
            if (Number.isFinite(rowNum) && rowNum > maxRows) {
                throw new ExcelGuardError(`الملف يحوي ${rowNum} صفًا — الحد ${maxRows}`);
            }
        }
        return wb;
    }

    return { assertFileSize, readWorkbook, ExcelGuardError, MAX_BYTES, MAX_ROWS };
}));
