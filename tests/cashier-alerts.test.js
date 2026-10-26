// ────────────────────────────────────────────────────────────────────────────
// cashier-alerts.test.js — طلب المالك 2026-10-06
// «هل الكاشير يعمل بالدرج الفلوس؟» + «عايز نغمة صغيره لما بيضرب من الزاير
//  الاوردر تفاعل مع الكاشير»
//  1) درج النقدية: أي إيصال فيه دفع كاش ينتهي بنبضة فتح الدرج (ESC p 0)
//  2) أوردر جديد من الزائر: الميرور يميّز المُدرج جديدًا فعلًا ويبث حدثًا
//     تسمعه نغمة الكاشير فورًا (cha-ching) مع توست وتحديث شاشة المراقبة
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ESCPOS = fs.readFileSync(path.join(__dirname, '..', 'backend', 'cashier-module', 'escpos-printer.js'), 'utf8');
const MIRROR = fs.readFileSync(path.join(__dirname, '..', 'backend', 'yarasoft', 'mirror.js'), 'utf8');
const REALTIME = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'realtime.js'), 'utf8');

describe('درج النقدية: البيع الكاش يفتح الدرج تلقائيًا', () => {
    test('الإيصال ينتهي بنبضة ESC p 0 عند وجود دفع كاش', () => {
        expect(ESCPOS).toContain('درج النقدية');
        expect(ESCPOS).toContain('/cash|نقد|كاش/i');
        expect(ESCPOS).toContain('Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])');
        // النبضة بعد القطع — الإيصال يطبع ثم يفتح الدرج
        const cutMark = ESCPOS.indexOf('CMD.CUT_PAPER');
        const kickMark = ESCPOS.indexOf('Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])');
        expect(kickMark).toBeGreaterThan(cutMark);
    });
    test('بعد النبضة يأتي return واحد فقط (لا ازدواج)', () => {
        const after = ESCPOS.slice(ESCPOS.indexOf('Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])'));
        expect((after.match(/return Buffer\.concat\(chunks\)/g) || []).length).toBe(1);
    });
});

describe('نغمة الأوردر الجديد من الزائر عند الكاشير', () => {
    test('الميرور يميّز المُدرج جديدًا فعلًا (مقارنة بالمستندات المعروفة قبل الحلقة)', () => {
        expect(MIRROR).toContain('knownDocs');
        expect(MIRROR).toContain('out.newDocs.push');
        expect(MIRROR).toContain("io.emit('yarasoft:new-orders'");
        expect(MIRROR).toContain('WHERE doc_no = ANY($1::text[])');
    });
    test('realtime يسمع الحدث: نغمة cha-ching + توست + تحديث شاشة المراقبة', () => {
        expect(REALTIME).toContain("socket.on('yarasoft:new-orders'");
        expect(REALTIME).toContain('AudioEngine.playSale()');
        expect(REALTIME).toContain('أوردر جديد من الزائر');
        expect(REALTIME).toContain('renderCashierMonitor');
    });
});
