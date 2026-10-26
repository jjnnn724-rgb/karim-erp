'use strict';
/* zk-close-stale.js — إغلاق صفوف النسيان المفتوحة (انصراف مستنتج بمدة الموظف المعتادة).
 * آمن وتكراري: يقفل فقط ما تجاوز الوردية + ساعتين، وموسوم checkout_inferred قابل للتراجع. */
const { pool } = require('../backend/shared-pool');
const { AttendanceEngine } = require('../backend/attendance-engine');
const fs = require('fs');
const path = require('path');

(async () => {
    // قفل ضد التداخل: تخطَّ لو تشغيل آخر بدأ من أقل من 25 دقيقة
    const lock = path.join(__dirname, '..', 'logs', 'stale-close.lock');
    try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age < 25 * 60 * 1000) { console.log('STALE_CLOSE=skipped:overlap'); process.exit(0); }
    } catch (_) {}
    fs.writeFileSync(lock, String(process.pid));
    const eng = new AttendanceEngine();
    const r = await eng.closeStaleOpenRows();
    console.log('STALE_CLOSE=' + JSON.stringify(r).slice(0, 2000));
    await pool.end();
    try { fs.unlinkSync(lock); } catch (_) {}
    process.exit(0);
})().catch((e) => { console.error('FAIL:' + (e && e.message)); process.exit(1); });
