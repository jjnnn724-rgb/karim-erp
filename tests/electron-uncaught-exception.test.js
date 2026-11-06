/**
 * electron-uncaught-exception.test.js — أي خطأ غير ملتقط يُطفئ الخدمات بأمان ثم يخرج
 * ────────────────────────────────────────────────────────────────────────
 * القاعدة (مراجعة خارجية، FIX 2026-11-05): uncaughtException كان يسجّل الخطأ في
 * اللوق فقط ثم يبقى التطبيق حيًّا بحالة غير معروفة (ذاكرة متسخة/خدمات نصف منتهية).
 * الآن: shutdownAllServices() (يتخطى نفسه أثناء الإيقاف) ثم process.exit(1) —
 * لا process.exit(0) (ليس إغلاقًا نظيفًا يطلبه المستخدم)، ولا صمت.
 *
 * عقد المصدر هذا مقصود: electron/main.js لا يُحمَّل داخل jest (يحتاج ثنائية
 * electron وخدمات النظام) — الاختبار يثبّت بنية المعالج قبل أي نشر.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
const uncaughtIdx = src.indexOf("process.on('uncaughtException'");

describe('Electron — uncaughtException إطفاء مضبوط', () => {
    it('المعالج موجود ومعرّف', () => {
        expect(uncaughtIdx).toBeGreaterThan(-1);
    });

    it('يستدعي shutdownAllServices قبل الخروج (لا خروج بلا إطفاء)', () => {
        const block = src.slice(uncaughtIdx, uncaughtIdx + 900);
        expect(block).toMatch(/await\s+shutdownAllServices\(\)/);
        expect(block).toMatch(/process\.exit\(1\)/);
        expect(block).not.toMatch(/process\.exit\(0\)/);
    });

    it('الخروج بكود خطأ (1) لا نجاح (0)', () => {
        const block = src.slice(uncaughtIdx, uncaughtIdx + 900);
        expect(block).toMatch(/process\.exit\(1\)\s*;?\s*\n?\s*\}\);?/);
    });

    it('اللوق لا يبتلع الخطأ بلا أثر — المعالج يعمل حتى لو فشل الإيقاف', () => {
        const block = src.slice(uncaughtIdx, uncaughtIdx + 900);
        expect(block).toMatch(/catch/);
        expect(block).toMatch(/process\.exit\(1\)/);
    });

    it('shutdownAllServices مُصدَّر لإمكان اختباره واستدعاؤه من مسارات الخروج', () => {
        expect(src).toMatch(/shutdownAllServices,/);
    });
});
