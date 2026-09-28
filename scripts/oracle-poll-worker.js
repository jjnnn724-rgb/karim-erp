#!/usr/bin/env node
/**
 * oracle-poll-worker.js — عامل Oracle قصير العمر (سحب + لحاق)
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا عملية منفصلة؟ مكتبة oracledb في Thick mode (ضرورية لترميز AR8MSWIN1256
 * لقاعدة يارسوفت) تنشئ خيوطًا أصلية داخل عملية السيرفر. لاحظنا على هذا الجهاز
 * أن أحد هذه الخيوط يدور (spin) بحرق نواة CPU كاملة بعد ساعة تقريبًا من بقاء
 * العملية حية — مما يُجهض أداء السيرفر بالكامل.
 *
 * الحل: كل عمل Oracle (دورة السحب + لحاق الفواتير الفائتة) يُنفَّذ في عملية
 * تُنشأ وتُغلق — لا تبقى خيوط Oracle في عملية السيرفر إطلاقًا.
 *
 * الاستخدام الداخلي: يستدعيه server.js دوريًا. يدويًا:
 *   node scripts/oracle-poll-worker.js          (سحب + لحاق)
 *   node scripts/oracle-poll-worker.js poll     (سحب فقط)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// حارس قاتل: أي دورة تعلق (اتصال/استعلام/إغلاق) تُقتل العملية كلها بعد 8 دقائق
setTimeout(() => {
    console.error('[oracle-poll-worker] TIMEOUT after 8 minutes — self-kill');
    process.exit(3);
}, 8 * 60 * 1000).unref();

async function main() {
    const link = require('../backend/yarasoft/oracle-link');
    const engine = link.oracleEngine;

    // 1) دورة السحب (نفس ما كان يعمل oe.start()/pollOnce داخل السيرفر)
    const result = await engine.pollOnce();
    if (result && result.ok) {
        console.log(`[oracle-poll-worker] poll ok: ${result.rows} rows`);
    } else {
        console.error(`[oracle-poll-worker] poll failed: ${(result && result.error) || 'unknown'}`);
    }

    // 2) لحاق الفواتير الفائتة (ما كان يعمله sync-doctor.bootCatchUp داخل السيرفر)
    const mode = process.argv[2] || 'catchup';
    if (mode === 'catchup') {
        try {
            const doctor = require('../backend/yarasoft/sync-doctor');
            const summary = await doctor.catchUp(doctor.catchupDays(), null);
            console.log(`[oracle-poll-worker] catchup: ${summary?.ok ? 'ok' : 'failed'}${summary?.error ? ' — ' + summary.error : ''}`);
        } catch (e) {
            console.error('[oracle-poll-worker] catchup error:', e.message);
        }
    }
}

main().then(async () => {
    // أغلق الاتصال المحتفظ به حتى تخرج كل خيوط Oracle مع العملية
    try {
        const link = require('../backend/yarasoft/oracle-link');
        await link.closeKeptConn();
    } catch (_) {}
    // مهلة قصيرة تمنع assertion libuv عند الخروج مع مقابض تُغلق (Node 26/Windows)
    setTimeout(() => process.exit(0), 150);
}).catch((e) => {
    console.error('[oracle-poll-worker] error:', e.message);
    setTimeout(() => process.exit(1), 150);
});
