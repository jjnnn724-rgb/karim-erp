/**
 * yarasoft-staging-retention.test.js — عقد تغطية اللحاق واحتفاظ مخلفات staging
 * ═══════════════════════════════════════════════════════════════════════════
 * الفشل الذي أنتج 130 جيجا على قرص C: عدّاد التغطية في sync-doctor كان يحسب
 * كل فواتير أوراكلي، بينما المستهلِك يرفض المبلغ غير الموجب ولا يسجّله أبدًا.
 * فالنافذة لا تُصبح «مغطّاة» مهما أُعيد سحبها → سحبا كامل كل دورة (6 جيجا/يوم).
 *
 * العقود هنا قراءة مصدر + سلوك خالص (بلا قاعدة بيانات ولا تنفيذ ديناميكي):
 *   • عدّاد التغطية يستثني الفواتير غير القابلة للتسجيل بنفس شرط المستهلِك.
 *   • قاعدة «مبلغ صالح» واحدة في oracle-consume لا نسختين متقابلتين.
 *   • ملفات .json.done المستهلكة تُحذف بعد عمر افتراضي، والمرتبطة قيد الانتظار لا.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend', 'yarasoft');
const DOCTOR = path.join(BACKEND, 'sync-doctor.js');
const CONSUME = path.join(BACKEND, 'oracle-consume.js');
const WORKER = path.join(__dirname, '..', 'scripts', 'oracle-poll-worker.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('عدّاد التغطية — نفس شرط المستهلِك', () => {
    const doctor = read(DOCTOR);

    test('حارس النافذة وحلقة المراجعة يعدّان مستندات بمبلغ صالح لا سطورًا غفلاء', () => {
        const postable = /COUNT\(DISTINCT CASE WHEN COALESCE\(NET_VAL, TOTAL_VAL, 0\) > 0 THEN DOC_NO END\)/g;
        const matches = doctor.match(postable) || [];
        // c1 + c2 في catchUp، وعدّاد اليومين (CC وBILLS4) في reconcile
        expect(matches.length).toBeGreaterThanOrEqual(4);
    });

    test('لا يبقى عدّاد COUNT(*) بلا شرط مبلغ في مسار اللحاق', () => {
        const catchUp = doctor.slice(doctor.indexOf('async function catchUp'));
        expect(catchUp).not.toMatch(/SELECT COUNT\(\*\) AS C FROM (CC_BILLS3|BILLS4)/);
    });
});

describe('قاعدة المبلغ الصالح — مصدر وحيد', () => {
    const { isPostableTotal } = require(CONSUME);

    test('طوابع تطابق شرط SQL: COALESCE(NET_VAL, TOTAL_VAL, 0) > 0', () => {
        expect(isPostableTotal(349.99)).toBe(true);
        expect(isPostableTotal(0)).toBe(false);
        expect(isPostableTotal(-15)).toBe(false);
        expect(isPostableTotal(null)).toBe(false);
        expect(isPostableTotal(undefined)).toBe(false);
        expect(isPostableTotal(NaN)).toBe(false);
    });

    test('المستهلِك يستخدم القاعدة نفسها بدل إعادة كتابة الشرط', () => {
        const consume = read(CONSUME);
        expect(consume).toMatch(/if \(!isPostableTotal\(invTotal\)\)/);
        expect(consume).toMatch(/module\.exports = \{[^}]*isPostableTotal/);
    });
});

describe('احتفاظ مخلفات staging — pruneConsumed', () => {
    let dir;
    const HOUR = 3600 * 1000;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-staging-'));
        process.env.YARASOFT_ORACLE_STAGING = dir;
        const stamp = (name, ageHours) => {
            const p = path.join(dir, name);
            fs.writeFileSync(p, '{}');
            const t = new Date(Date.now() - ageHours * HOUR);
            fs.utimesSync(p, t, t);
        };
        stamp('ys_ora_1.json.done', 72);
        stamp('ys_ora_catchup_2026-01-01_2026-01-08_2.json.done', 60);
        stamp('ys_ora_3.json.done', 2);
        stamp('ys_ora_4.json', 72);          // غير مستهلكة بعد — لا تُمَسّ
        stamp('invoice-999.pdf.done', 90);   // خارج تسمية staging — لا تُمَسّ
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        delete process.env.YARASOFT_ORACLE_STAGING;
    });

    test('تحذف المستهلكة الأقدم من الأُفق وتُبقي كل ما عداه', () => {
        const { pruneConsumed } = require(CONSUME);
        const r = pruneConsumed(48);
        expect(r.removed).toBe(2);
        expect(r.hours).toBe(48);
        const left = fs.readdirSync(dir).sort();
        expect(left).toEqual([
            'invoice-999.pdf.done',
            'ys_ora_3.json.done',
            'ys_ora_4.json',
        ]);
    });

    test('العامل ينادي التنظيف بعد الاسترداد، بفشل معزول لا يُسقط الدورة', () => {
        const worker = read(WORKER);
        expect(worker).toMatch(/pruneConsumed\(\)/);
        expect(worker).toMatch(/staging prune error:/);
        // التنظيف بعد خطوة الاسترداد حتى يسبقه العمل الحتمي
        expect(worker.indexOf('recoverStaleImports')).toBeLessThan(worker.indexOf('pruneConsumed'));
    });
});
