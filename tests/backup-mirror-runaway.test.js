/**
 * backup-mirror-runaway.test.js — عقد حداثة النسخ وتقدير المرايا
 * ═══════════════════════════════════════════════════════════════
 * النبضة كانت تنتج pg_dump كاملًا كل خمس دقائق: watchdog كان يقيس الحداثة على
 * الاسم الصريح `karim-erp-nightly-<stamp>.dump`، وخط الأنابيب يحذف الصريح فور
 * نجاح التشفير (تدعيم 2026-10-26) — فالقائمة تبقى فارغة، والعمر الوهمي 9999
 * ساعة، و«backup-stale» يستدعي backup-nightly في كل دورة. المقيس على القرص:
 * 1,819 مجموعة متجاورة بفواصل خمس دقائق = 141.84 جيجا في D:/KarimBackups
 * \nightly-dump ومثلها في E:.
 *
 * العقود هنا قراءة مصدر + سلوك خالص على مجلد مؤقت (بلا قاعدة بيانات):
 *   • الحداثة تُقاس على الأثر المتبقي (الصريح أو المشفَّر).
 *   • المرايا لها سقف، والسقف مبطَّن حتى يُصرَّح (الحذف الأول ~280 جيجا).
 *   • pruneBackupGroups يحذف المجموعة كلها — أرشيفًا وبصماتٍ لا يتامى.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WATCHDOG = path.join(ROOT, 'scripts', 'watchdog.js');
const NIGHTLY = path.join(ROOT, 'scripts', 'backup-nightly.js');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('حداثة النسخ — تُقاس على ما يبقى فعلًا', () => {
    const src = read(WATCHDOG);
    const probe = src.slice(src.indexOf('// ── 5)'));
    // حرفيًا لا بنمطٍ فوق نمط: النص الذي يجب أن يظهر في المصدر
    const ACCEPTS_ENCRYPTED = '/^karim_erp-nightly-\\d+\\.dump(\\.kbak|\\.gpg)?$/';
    const PLAINTEXT_ONLY = '/^karim_erp-nightly-\\d+\\.dump$/';

    test('نمط الاستعلام يقبل الصريح و.kbak و.gpg', () => {
        expect(probe.includes(ACCEPTS_ENCRYPTED)).toBe(true);
    });

    test('لا يبقى نمط الصريح وحده الذي لا يطابقه شيء بعد التشفير', () => {
        expect(probe.includes(PLAINTEXT_ONLY)).toBe(false);
    });

    test('عتبة الثلاثين ساعة واستدعاء backup-nightly كما هما — الكفّ في النمط لا في البابين', () => {
        expect(probe).toMatch(/ageH > 30/);
        expect(probe).toMatch(/backup-nightly\.js/);
    });
});

describe('سقف المرايا — موجود ومبطَّن', () => {
    const src = read(NIGHTLY);

    test('السقف يُقرأ من البيئة وأوله صفر (لا حذف بلا تصريح)', () => {
        expect(src).toMatch(/KARIM_MIRROR_KEEP/);
        expect(src).toMatch(/const MIRROR_KEEP = Number\(process\.env\.KARIM_MIRROR_KEEP \|\| 0\);/);
        expect(src).toMatch(/if \(MIRROR_KEEP > 0\) \{/);
    });

    test('التدوير يجري على جذري المرايا وتسميتيهما بالاسم الأساسي الصحيح', () => {
        expect(src).toMatch(/require\('\.\/backup-mirror'\)/);
        expect(src).toMatch(/MIRROR_ROOTS/);
        expect(src).toMatch(/\[\['nightly-dump', dumpBase\], \['nightly-data', zipBase\]\]/);
        expect(src).toMatch(/pruneBackupGroups\(dir, groups, MIRROR_KEEP\)/);
    });

    test('فشل التدوير لا يُفشل النسخة — تحذير فقط', () => {
        const block = src.slice(src.indexOf('const MIRROR_KEEP'), src.indexOf('// ── لا نص صريح'));
        expect(block).toMatch(/mirror rotation skipped/);
    });

    test('المفتاح موثَّق في نموذج البيئة', () => {
        expect(read(ENV_EXAMPLE)).toMatch(/KARIM_MIRROR_KEEP/);
    });
});

describe('pruneBackupGroups — المجموعة تُحذف كاملة', () => {
    const { collectBackupGroups, pruneBackupGroups, dumpBase } = require(path.join(ROOT, 'scripts', 'backup-retention'));

    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-mirror-prune-'));
        // ثلاث ليالٍ: أرشيف مشفَّر + بصمته، والأحدث أولاً بالأسماء
        for (const stamp of ['20261101000001', '20261102000001', '20261103000001']) {
            const base = `karim_erp-nightly-${stamp}.dump.kbak`;
            for (const name of [base, `${base}.sha256`]) {
                const p = path.join(dir, name);
                fs.writeFileSync(p, 'x');
                fs.utimesSync(p, new Date(), new Date(`2026-11-${stamp.slice(6, 8)}T03:00:00Z`));
            }
        }
    });
    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });

    test('سقف 2 يُبقي الأحدث ويحذف الأقدم أرشيفًا وبصمةً', () => {
        const removed = pruneBackupGroups(dir, collectBackupGroups(dir, dumpBase), 2);
        expect(removed).toHaveLength(1);
        const left = fs.readdirSync(dir).sort();
        expect(left.filter((f) => f.includes('20261101'))).toEqual([]);
        expect(left.filter((f) => f.includes('20261102'))).toHaveLength(2);
        expect(left.filter((f) => f.includes('20261103'))).toHaveLength(2);
    });

    test('السقف الأعلى من العدد لا يحذف شيئًا', () => {
        expect(pruneBackupGroups(dir, collectBackupGroups(dir, dumpBase), 30)).toEqual([]);
        expect(fs.readdirSync(dir)).toHaveLength(6);
    });

    test('مجلدٌ غائب لا يرمي — المجموعات فارغة', () => {
        const missing = path.join(dir, 'no-such-dir');
        expect(collectBackupGroups(missing, dumpBase)).toEqual([]);
        expect(pruneBackupGroups(missing, [], 1)).toEqual([]);
    });
});
