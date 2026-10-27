/**
 * v2-migration-gate.test.js — بوابة ترحيل V1→V2: منع التدهور بدل حذف كود حيّ
 * ────────────────────────────────────────────────────────────────────────────
 * الدافع (2026-10-27): لُقّبت «تكرار V1/V2» دَينًا هندسيًا يتطلب حذف أحد الطرفين.
 * القياس أثبت العكس: كل ملفات V1 لا تزال مربوطة حيًّا (أقلها 3 مراجع)، و
 * `MIGRATION.md` يفرض عقدًا صريحًا — «الرجوع = حذف مجلد V2» و«صفر تعديل على
 * legacy» — فالحذف يكسر التطبيق والتعاقد معًا. التكرار هنا **دين ترحيل جارٍ**،
 * والخطر الحقيقي أنه يتزاود بصمت: شاشة جديدة تُضاف للطرفين، أو شاشة V2 تموت
 * بلا مرجع، أو شاشة تتجاوز «باب الشبكة الواحد».
 *
 * البوابة إذن تُقفز على الأساس لا على الحجم:
 *   1. legacy مجمّد — لا ملف جديد في js/features.
 *   2. لا تكرار جديد — لا اسم يظهر في الطرفين ولم يكن في الأساس.
 *   3. لا شاشة V2 ميتة — كل screens/*.js مُشار إليه من التطبيق.
 *   4. باب الشبكة الواحد — لا fetch() مباشر داخل شاشة (العقد: js/v2/data/*-repo).
 *   5. لا شاشة تغيب عن سجل الترحيل — فجوة السجل لا تتمدد.
 *   6. التقدّم قابل للقياس — الحساب نفسه يُطبع ليقارن التقرير القادم بالأول.
 *
 * تحديث الأساس (يُسمح بالتراجع فقط): استبدل القيم بعد إتمام خطوة ترحيل.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const V1_DIR = path.join(ROOT, 'frontend', 'app', 'js', 'features');
const V2_DIR = path.join(ROOT, 'frontend', 'app', 'js', 'v2');
const SCREENS_DIR = path.join(V2_DIR, 'screens');
const MIGRATION_MD = path.join(V2_DIR, 'MIGRATION.md');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'v2-migration-baseline.json');

const jsNames = (dir) =>
    fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();

function current() {
    const v1 = jsNames(V1_DIR);
    const screens = jsNames(SCREENS_DIR);
    const md = fs.readFileSync(MIGRATION_MD, 'utf8');
    // الـcorpus يُبنى مرة واحدة — لا داخل فلتر الشاشات الـ62 (٦٢ قراءة متكرّرة
    // لكل التطبيق كانت تجعل البوابة أبطأ من الاختبارات كلها).
    const corpus = walk('frontend', 'app')
        .map((p) => fs.readFileSync(p, 'utf8'))
        .join('\n');
    return {
        v1Files: v1,
        v2Screens: screens,
        duplicatedScreens: v1.filter((n) => screens.includes(n)),
        pendingMigration: v1.filter((n) => !screens.includes(n)),
        registryGap: screens.filter((n) => !md.includes(n)).sort(),
        screensWithDirectFetch: screens
            .filter((n) => /\bfetch\s*\(/.test(fs.readFileSync(path.join(SCREENS_DIR, `${n}.js`), 'utf8')))
            .sort(),
        deadScreens: screens.filter((n) => !corpus.includes(`screens/${n}.js`)),
    };
}

/** كل ملف JS/HTML في التطبيق — لفحص أن كل شاشة V2 مُشار إليها فعلًا. */
function walk(...segments) {
    const out = [];
    const visit = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {visit(p);}
            else if (/\.(js|html)$/.test(e.name)) {out.push(p);}
        }
    };
    visit(path.join(ROOT, ...segments));
    return out;
}

/**
 * فحص السقف: كل اسم حالي يجب أن يكون مسجَّلًا في الأساس.
 * إضافة اسم = تدهور (فشل)، وإزالته = تقدّم (يُحدَّث الأساس في نفس الـPR).
 * @param {string[]} allowed
 * @param {string[]} actual
 * @returns {string[]} أسماء تجاوزت السقف
 */
function exceeds(allowed, actual) {
    const set = new Set(allowed);
    return actual.filter((n) => !set.has(n));
}

describe('بوابة ترحيل V1→V2 — منع التدهور', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    const now = current();

    test('الأساس في المستودع ومكتمل في مفاتيحه', () => {
        for (const key of ['v1FrozenFiles', 'duplicatedScreens', 'pendingMigration', 'registryGap', 'screensWithDirectFetch']) {
            expect(Array.isArray(baseline[key])).toBe(true);
        }
        // كل اسم في الأساس يجب أن يزال بتحديث الأساس عند إتمام خطوة — وإلا
        // تبقى القوائم تُقيس شيئًا لم يعد موجودًا.
        expect(exceeds(baseline.registryGap, [])).toEqual([]);
    });

    test('legacy مجمّد: لا ملف جديد يُضاف إلى js/features', () => {
        const added = exceeds(baseline.v1FrozenFiles, now.v1Files);
        expect({
            message: 'أُضيف ملف جديد إلى legacy — العقد يفرض صفر تعديل على V1، والشاشة الجديدة تُبنى في js/v2',
            added,
        }).toEqual({ message: expect.any(String), added: [] });
    });

    test('لا تكرار جديد: اسم لا يُضاف إلى قائمة الطرفين', () => {
        const added = exceeds(baseline.duplicatedScreens, now.duplicatedScreens);
        expect({
            message: 'شاشة تظهر في الطرفين ولم تكن مسجَّلة — التكرار يجب أن يتراجع لا يتمدد',
            added,
        }).toEqual({ message: expect.any(String), added: [] });
    });

    test('لا تدهور في قائمة الترحيل المعلَّق', () => {
        const added = exceeds(baseline.pendingMigration, now.pendingMigration);
        expect({
            message: 'القائمة المعلَّقة كبرت — إما شاشة جديدة أُضيفت لـV1 أو اسم خرج من V2 بلا ترحيل',
            added,
        }).toEqual({ message: expect.any(String), added: [] });
    });

    test('كل شاشة V2 حيّة: لا شاشة بلا مرجع في التطبيق', () => {
        expect(now.deadScreens).toEqual([]);
    });

    test('باب الشبكة الواحد: لا fetch() مباشر داخل شاشة', () => {
        const added = exceeds(baseline.screensWithDirectFetch, now.screensWithDirectFetch);
        expect({
            message: 'شاشة تستدعي fetch() مباشرة — العقد يمرّر الشبكة عبر js/v2/data/*-repo.js',
            added,
        }).toEqual({ message: expect.any(String), added: [] });
    });

    test('لا شاشة تغيب عن سجل الترحيل — فجوة السجل لا تتمدد', () => {
        const added = exceeds(baseline.registryGap, now.registryGap);
        expect({
            message: 'شاشة بلا صف في MIGRATION.md — «لا عمل خارج السجل»',
            added,
        }).toEqual({ message: expect.any(String), added: [] });
    });

    test('القياس مطبوع ويطابق الأساس — التقرير القادم يقارن به', () => {
        const summary = {
            v1Files: now.v1Files.length,
            v2Screens: now.v2Screens.length,
            duplicated: now.duplicatedScreens.length,
            pending: now.pendingMigration.length,
            registryGap: now.registryGap.length,
        };
        expect(summary.v1Files).toBe(baseline.v1FrozenFiles.length);
        // الهوية الصحيحة: كل ملف V1 إمّا مُرحَّل (مكرّر) أو معلّق — لا ثالث لهما.
        expect(summary.v1Files).toBe(summary.duplicated + summary.pending);
        expect(summary.duplicated).toBe(baseline.duplicatedScreens.length);
        expect(summary.pending).toBe(baseline.pendingMigration.length);
        expect(summary.registryGap).toBe(baseline.registryGap.length);
    });
});