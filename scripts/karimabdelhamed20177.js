#!/usr/bin/env node
/**
 * karimabdelhamed20177 — الإقلاع الذكي المحمول (Portable Smart Bootstrap)
 * ════════════════════════════════════════════════════════════════════════
 * نقطة الدخول الرسمية لتشغيل المشروع على أي جهاز بعد نقل مجلّه.
 * صفر اعتماد على مكان التشغيل: يحلّ جذر المشروع من موقع هذا الملف نفسه،
 * ثم يفوّض المحرك الشامل (scripts/deploy-machine.mjs) الذي:
 *   • يضبط المسارات المطلقة في .env تلقائيًا (يعيد توطينها لمجلد بيانات
 *     مشترك لكل جهاز: ProgramData/KarimERP على ويندوز، /var/lib على لينكس)
 *   • يولّد الأسرار الناقصة (JWT_ACCESS/REFRESH/EMPLOYEE_QR)
 *   • يثبّت node_modules إن غابت
 *   • يكتشف PostgreSQL + المنفذ + يختبر الاتصال
 *   • يطبّق الترحيلات ويهرّج كلمات المرور ويجري اختبارًا تدخينيًا
 *
 * الاستخدام:
 *   node scripts/karimabdelhamed20177.js              نشر/إصلاح كامل
 *   node scripts/karimabdelhamed20177.js --doctor     فحص فقط بلا أي تغيير
 *   npm run karimabdelhamed20177                      نفس النشر الكامل
 *   npm run karimabdelhamed20177:doctor               نفس الفحص فقط
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ─── حلّ الجذر من موقع هذا الملف (لا من مجلد التشغيل الحالي) ───
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'scripts', 'deploy-machine.mjs');

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    gold: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
};

function banner(doctor) {
    console.log('');
    console.log(`${C.bold}${C.gold}╔══════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.gold}║   karimabdelhamed20177 — الإقلاع الذكي المحمول            ║${C.reset}`);
    console.log(`${C.gold}╚══════════════════════════════════════════════════════════╝${C.reset}`);
    console.log(`${C.dim}جذر المشروع :${C.reset} ${ROOT}`);
    console.log(`${C.dim}الوضع       :${C.reset} ${doctor ? C.cyan + 'فحص فقط (DOCTOR) — لن يُعدَّل أي شيء' + C.reset : C.green + 'نشر/إصلاح كامل' + C.reset}`);
    console.log('');
}

function usage() {
    console.log(`الاستخدام:
  node scripts/karimabdelhamed20177.js [خيارات]

الخيارات:
  --doctor, -d, check     فحص فقط وعرض ما سيُفعل بلا أي تغيير
  --verbose               تفاصيل أكثر
  --help, -h              هذه المساعدة`);
}

function main() {
    const raw = process.argv.slice(2);
    if (raw.includes('--help') || raw.includes('-h')) { banner(false); usage(); process.exit(0); }

    // توحيد مرادفات "الفحص فقط" إلى --doctor
    const doctor = raw.includes('--doctor') || raw.includes('-d') || raw.includes('check');
    const forward = raw.filter((a) => a !== '-d' && a !== 'check');
    if (doctor && !forward.includes('--doctor')) { forward.push('--doctor'); }

    banner(doctor);

    if (!fs.existsSync(ENGINE)) {
        console.error(`${C.red}✗ محرك النشر غير موجود:${C.reset} ${ENGINE}`);
        console.error(`${C.dim}  تأكد من نسخ مجلد المشروع بالكامل (بما فيه scripts/deploy-machine.mjs).${C.reset}`);
        process.exit(2);
    }

    // تشغيل المحرك بنفس مُفسّر node الحالي، مع تمرير الإخراج والوسائط
    const child = spawn(process.execPath, [ENGINE, ...forward], {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
        windowsHide: false,
    });

    child.on('error', (e) => {
        console.error(`${C.red}✗ تعذّر تشغيل المحرك:${C.reset} ${String(e.message).slice(0, 200)}`);
        process.exit(1);
    });
    child.on('exit', (code, signal) => {
        if (signal) { process.exit(1); }
        process.exit(typeof code === 'number' ? code : 0);
    });
}

main();
