// ────────────────────────────────────────────────────────────────────────────
// punch-dedup-guard.test.js — بلاغ المالك كريم عبد الحميد 2026-10-06
// «بصمت اليوم من كاميرا الهاتف ولم تظهر» — بصمة وجه موثقة (ثقة 100) قُبلت ثم
// جُحتها بقرار «مكررة خلال 5 دقائق» من كاش راسب لا تعرفه القاعدة.
//
// 2026-11-05: محرك الحضور كُتب من جديد (مصدران معتمدان فقط، بلا استكمال).
// الكاش أُُلغي بالكامل، فالدرس الأصلي يُقفل الآن بوجهه الإيجابي:
//   لا قرار «تجاهل» بلا دليل صفّ في القاعدة، ولا حالة في الذاكرة بين بصمتين.
// النافذة التي كان يحرسها الكاش صارت استعلام تبريد على أطراف attendance —
// مقفولة وحدها في punch-cooldown-guard.test.js.
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');

describe('حرس التكرار في محرك الحضور — تجاهل البصمة يحتاج دليلًا من القاعدة لا من الذاكرة', () => {
    test('لا حالة بصمات في الذاكرة بين الطلبات: الكاش الراسب مُحذوف أصلًا', () => {
        expect(ENGINE).not.toMatch(/lastPunches/);
        expect(ENGINE).not.toMatch(/punchCache|recentPunch|dedupCache/);
        const ctor = ENGINE.slice(ENGINE.indexOf('constructor() {'), ENGINE.indexOf('setIO(io)'));
        expect(ctor).toContain('this.io = null;');
        expect(ctor).not.toMatch(/Map\(\)|new Set\(\)|this\.[a-zA-Z]+ = \{/);
    });

    test('قراءة أطراف الحضور كلها FOR UPDATE — لا قارئ يرى صفًّا وقد سبقه كاتب', () => {
        expect(ENGINE).toContain('ORDER BY date DESC LIMIT 1 FOR UPDATE');
        expect(ENGINE).toContain('SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE');
        // لا قراءة ثالثة بلا قفل تُبتنى عليها كتابة (كانت ثلاثًا بمسارات التكرار القديمة)
        expect((ENGINE.match(/FROM attendance WHERE "employeeId" = \$1 AND date = \$2 FOR UPDATE/g) || []).length)
            .toBe(1);
    });

    test('كل «تجاهل» مُسبَّب بدليل من القاعدة، مُعلَّم للمراجعة، ثم COMMIT — لا تُترك معاملة معلّقة', () => {
        const ignores = [...ENGINE.matchAll(/action: 'ignore'/g)].map(m => m.index);
        expect(ignores.length).toBeGreaterThanOrEqual(3); // التبريد، تصادف 23505، بصمة مؤرخة قبل انصراف محجوز
        for (const at of ignores) {
            const before = ENGINE.slice(Math.max(0, at - 900), at);
            expect(before).toContain("await client.query('COMMIT');");
            expect(before).toContain('this.logDecision({'); // بلا سطر مراجعة لا يُقبَل تجاهل
        }
        // ولا تجاهل بسبب «ملصق لا نفهمه»: البصمة تُحجز والتسلسل يحكم
        expect(ENGINE).not.toMatch(/حالة بصمة غير معروفة/);
        expect(ENGINE).toContain("decision: 'state_conflict'");
    });

    test('التجاهل ضيقٌ إلى أقصى حد: تصادف لحظي (23505) وبصمة أقدم من انصراف محجوز', () => {
        expect(ENGINE).toContain("insertErr && insertErr.code === '23505'");
        expect(ENGINE).toContain('أقدم من انصراف محجوز');
        expect((ENGINE.match(/duplicate: true/g) || []).length).toBe(1);
        expect((ENGINE.match(/outOfOrder: true/g) || []).length).toBe(1);
        // وأيّ «دخول على صف مُدخل» أو «انصراف على صف مُنصرف» صار انصرافًا مُمتدًّا لا إهمالًا
        expect(ENGINE).not.toMatch(/مُدخل منذ/);
        expect(ENGINE).not.toMatch(/مُنصرف منذ/);
    });

    test('النافذة تشمل يوم الوردية ويومَها السابق — انصراف الفجر على صف الأمس', () => {
        expect((ENGINE.match(/date IN \(\$2, \$3\)/g) || []).length).toBeGreaterThanOrEqual(2);
        expect((ENGINE.match(/prevDay\(shiftDate\)/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('فشل الكتابة يلفّ المعاملة ويرفع الخطأ — بلا أثرٍ داخلي يبتلع بصمة تالية', () => {
        const failMark = ENGINE.indexOf('logger.error(`[AttendanceEngine] processPunch failed:');
        expect(failMark).toBeGreaterThan(-1);
        const beforeFail = ENGINE.slice(Math.max(0, failMark - 300), failMark);
        expect(beforeFail).toContain("await client.query('ROLLBACK').catch(() => {});");
        expect(ENGINE.slice(failMark, failMark + 480)).toContain('throw error;');
        expect(ENGINE.slice(failMark, failMark + 480)).toContain('client.release();');
    });

    test('القفل الاستشاري يسبق أي قراءة أو كتابة في المعاملة', () => {
        const lockAt = ENGINE.indexOf('pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))');
        const firstRead = ENGINE.indexOf('FROM attendance', lockAt);
        expect(lockAt).toBeGreaterThan(-1);
        expect(firstRead).toBeGreaterThan(lockAt);
        expect(ENGINE.slice(lockAt, firstRead)).not.toMatch(/INSERT INTO attendance|UPDATE attendance/);
    });
});
